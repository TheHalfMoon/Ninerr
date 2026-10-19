// Counterpart experiments for the 2026-10-18 design-platform study
// (docs/research/rea-design-platforms/NINERR_COUNTERPARTS_2026-10-18.md).
//
// Each case repeats, against Ninerr's own studio host and MCP server, an experiment the study
// ran against another product, so a comparison rests on observations of both sides. It prints
// one JSON report and changes nothing outside a temporary projects folder.
//
//   node scripts/research/ninerr-counterparts.mjs > report.json
//
// It records what Ninerr does today; it asserts nothing, so it is not a test. Cases that show a
// gap (C-02, C-03, C-07, C-08) are expected to change when the proposed P11 lands. Case C-n is
// recorded as E-NX-0n in the study's evidence index.
import dns from "node:dns";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { client, mcpClient } from "../../tests/support/host-api.mjs";
import { startStudioHost } from "../../packages/studio-host/src/index.ts";

// Any lookup of a name other than loopback through `dns.lookup`, and any `fetch` to a non-loopback
// URL, is recorded. Code that imported those functions by name before this script patched them is
// not covered, so an empty list shows only that these two paths were not used.
const network = [];
const loopback = (host) => host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
const lookup = dns.lookup;
dns.lookup = (host, ...rest) => { if (!loopback(host)) network.push(`dns:${host}`); return lookup(host, ...rest); };
const resolve = dns.promises.lookup;
dns.promises.lookup = (host, ...rest) => { if (!loopback(host)) network.push(`dns:${host}`); return resolve(host, ...rest); };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!loopback(url.hostname)) network.push(`fetch:${url.href}`);
  return realFetch(input, init);
};

let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 18, 12, 0, 0) + tick++ * 1000).toISOString();
const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-counterparts-")));
const host = await startStudioHost({ projectsRoot: root, now });
const owner = client(host.url, host.token);
const report = { ninerrCommit: process.env.NINERR_COMMIT ?? null, node: process.version, platform: process.platform, cases: {} };

async function agent(name) {
  const { token } = (await owner("POST", "/api/agents/create", { name })).json;
  const { rpc, tool } = mcpClient(host.mcpUrl, token);
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1" } });
  return async (toolName, args) => {
    const result = await tool(toolName, args);
    return { isError: result.isError === true, content: result.structuredContent ?? result.content?.[0]?.text };
  };
}
const documentNow = async () => (await owner("GET", "/api/document")).json;

try {
  await owner("POST", "/api/projects/create", { name: "counterparts" });
  const a = await agent("Agent A");
  const b = await agent("Agent B");
  const frameId = (await a("create_frame", { name: "Board", width: 400, height: 300 })).content.nodeId;
  const t1 = (await a("create_frame", { name: "T1", width: 10, height: 10 })).content.nodeId;
  const t2 = (await a("create_frame", { name: "T2", width: 10, height: 10 })).content.nodeId;

  // C-01 (E-PD-12): a batch of three moves whose third is invalid (a cycle).
  {
    const before = await documentNow();
    const result = await a("move_layers", { moves: [{ nodeId: t1, parentId: frameId }, { nodeId: t2, parentId: frameId }, { nodeId: frameId, parentId: t1 }] });
    const after = await documentNow();
    report.cases["C-01 batch atomicity"] = {
      refused: result.isError,
      message: String(result.content).slice(0, 200),
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      frameChildrenAfter: after.document.nodes[frameId].children,
      rootIdsAfter: after.document.rootIds.length,
    };
  }

  // C-02 (E-PD-03): agent A reads, agent B changes the same layer, then A writes.
  {
    const read = await a("layer_details", { nodeId: t1 });
    const revisionRead = (await documentNow()).revision;
    await b("set_styles", { updates: [{ nodeId: t1, styles: { background: "red" } }] });
    const write = await a("set_styles", { updates: [{ nodeId: t1, styles: { background: "blue" } }] });
    const after = await documentNow();
    report.cases["C-02 stale agent write"] = {
      agentReadSucceeded: !read.isError,
      revisionAgentRead: revisionRead,
      staleWriteRefused: write.isError,
      revisionAfter: after.revision,
      finalBackground: after.document.nodes[t1].props.style.background,
    };
  }

  // C-03 (E-PD-06, E-PD-07): styles that make no sense in context, then removed.
  {
    const write = await a("set_styles", { updates: [{ nodeId: t2, styles: { position: "absolute", "flex-grow": "1", gap: "8px", transform: "rotate(15deg)" } }] });
    const stored = (await documentNow()).document.nodes[t2].props.style;
    await a("set_styles", { updates: [{ nodeId: t2, styles: { position: null } }] });
    const afterRemoval = (await documentNow()).document.nodes[t2].props.style;
    report.cases["C-03 style interpretation"] = {
      accepted: !write.isError,
      reply: write.content,
      storedAfterWrite: stored,
      storedAfterRemovingPosition: afterRemoval,
    };
  }

  // C-04 (E-PD-13): hostile HTML through the person's import, with remote images.
  {
    const html = `<!doctype html><html><body><main><h2>Title</h2><p>Body <b>bold</b> <a href="javascript:alert(1)">bad</a> <a href="https://example.com/ok">ok</a></p><button onclick="alert(1)">Go</button><img src="https://example.com/remote.png" alt="r"><script>alert(1)</script></main></body></html>`;
    const review = await owner("POST", "/api/import", { html, name: "Hostile" });
    const commit = review.status === 200 ? await owner("POST", "/api/import/commit", { proposalId: review.json.proposalId }) : null;
    const { document } = await documentNow();
    const imported = Object.values(document.nodes).filter((node) => node.metadata?.import !== undefined || (commit?.json?.frameId && isInside(document, node.id, commit.json.frameId)));
    report.cases["C-04 hostile import"] = {
      reviewStatus: review.status,
      reviewNotes: review.json?.diagnostics ?? review.json?.removed ?? null,
      commitStatus: commit?.status ?? null,
      tags: imported.map((node) => node.props.tag).filter(Boolean),
      anchors: imported.filter((node) => node.props.tag === "a").map((node) => node.props),
      button: imported.filter((node) => node.props.tag === "button").map((node) => node.props.attributes ?? null),
      images: imported.filter((node) => node.props.tag === "img").map((node) => node.props),
      scripts: imported.filter((node) => node.props.tag === "script").length,
      boldKept: imported.some((node) => node.props.tag === "b"),
      networkDuringImport: [...network],
    };
  }

  // C-05 (E-PD-08, a different case): what an agent-created layer stores.
  {
    const node = (await documentNow()).document.nodes[frameId];
    report.cases["C-05 stored form"] = { type: node.type, props: node.props };
  }

  // C-06 (E-PD: no undo through MCP): the agent's change is undone by the person.
  {
    const before = (await documentNow()).revision;
    const toolsList = await mcpClient(host.mcpUrl, (await owner("POST", "/api/agents/create", { name: "Lister" })).json.token);
    await toolsList.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l", version: "1" } });
    const names = (await toolsList.rpc("tools/list", {})).tools.map((tool) => tool.name);
    const agentEdit = await a("set_text", { nodeId: t1, text: "agent text" });
    // What the person's Undo will take back: their own latest change in the history log.
    const { entries } = (await owner("GET", "/api/history")).json;
    const lastPersonChange = entries.filter((entry) => entry.actorKind === "user").at(-1) ?? null;
    // The person's Undo takes back the person's own last change; an agent's change is taken
    // back with Revert (#350 offers it beside Undo).
    const undo = await owner("POST", "/api/undo", {});
    const textAfterPersonUndo = (await documentNow()).document.nodes[t1].props.text ?? null;
    const revert = await owner("POST", "/api/revert", { transactionId: agentEdit.content.transactionId });
    const after = await documentNow();
    report.cases["C-06 undo of an agent change"] = {
      agentHasUndoTool: names.some((name) => /undo|revert/u.test(name)),
      toolCount: names.length,
      personUndoStatus: undo.status,
      textAfterPersonUndo,
      personUndoTookBack: lastPersonChange?.intent ?? null,
      personRevertStatus: revert.status,
      textAfterRevert: after.document.nodes[t1].props.text ?? null,
      revisionBefore: before,
      revisionAfter: after.revision,
    };
  }

  // C-07 (E-PD-04): an argument the tool does not know, and an invalid property name.
  {
    const unknownArg = await a("set_text", { nodeId: t1, text: "x", baseRevision: 0 });
    const badName = await a("set_styles", { updates: [{ nodeId: t1, styles: { "Bad Name": "1" } }] });
    report.cases["C-07 input validation"] = {
      unknownBaseRevisionArgument: unknownArg.isError ? `refused: ${String(unknownArg.content).slice(0, 160)}` : "accepted and ignored",
      invalidPropertyName: badName.isError ? `refused: ${String(badName.content).slice(0, 160)}` : "accepted",
      nullUnsetsAStyle: "see C-03",
    };
  }
  // C-08 (E-FG-18): an agent creates a layer, the person then edits that layer and, apart,
  // another one; the person reverts the agent's change.
  {
    const created = await a("create_frame", { name: "Agent card", width: 100, height: 50 });
    const cardId = created.content.nodeId;
    const current = await documentNow();
    const personEdit = await owner("POST", "/api/edit", { baseRevision: current.revision, intent: "Rename", operations: [{ type: "set-props", nodeId: cardId, set: { name: "Edited by the person" } }, { type: "set-props", nodeId: t2, set: { name: "Unrelated person edit" } }] });
    const revert = await owner("POST", "/api/revert", { transactionId: created.content.transactionId });
    const after = await documentNow();
    report.cases["C-08 revert after a later edit"] = {
      personEditStatus: personEdit.status,
      revertStatus: revert.status,
      revertCode: revert.json?.code ?? null,
      cardStillExists: after.document.nodes[cardId] !== undefined,
      cardName: after.document.nodes[cardId]?.props.name ?? null,
      unrelatedEditKept: after.document.nodes[t2].props.name === "Unrelated person edit",
    };
  }
  report.network = network;
} finally {
  await host.close();
  rmSync(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function isInside(document, id, ancestor) {
  for (let node = document.nodes[id]; node; node = document.nodes[node.parentId]) if (node.id === ancestor) return true;
  return false;
}
