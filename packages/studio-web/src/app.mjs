// The Ninerr editor. It holds a read-only copy of the open project's document and never
// changes it on its own: every edit goes to the studio host as one history transaction, and
// the copy advances only by applying the host's committed change events (from the edit's
// response or the event stream, whichever arrives first), in revision order. A gap or a
// change that does not apply means the copy is out of date, and it is fetched again.

import { mountCanvas, insertNode, removeNodes, setStyle, setText } from "/packages/canvas/src/index.mjs";
import { styleDeclarationProblem } from "/packages/renderer/src/index.mjs";
import { applyCommittedTransaction } from "/packages/history/src/index.mjs";
import { isCodePart, textLayerOf } from "/packages/document-model/src/index.mjs";
import { HostError, connect, forgetToken } from "/packages/studio-web/src/client.mjs";
import { UI_COMPONENT_SOURCE_GROUPS, searchUiComponentSources } from "/packages/component-sources/src/catalog.mjs";
import { RECORD_SOURCES, loadComponentRecords, searchComponents } from "/packages/component-sources/src/records.mjs";
import { TOKEN_TYPES } from "/packages/document-model/src/schema-v2.mjs";
import { addMode, addToken, createDesignSystem, deleteToken, designSystemOf, renameToken, setToken, tokenUses } from "/packages/document-model/src/tokens.mjs";
import { componentsFor, componentsOf, createComponent, detachInstance, insertInstance, instanceLayers, overrideFor, parseDeclarations, resetInstance, setInstanceOverride } from "/packages/canvas/src/components.mjs";

// While the Tokens dialog is open, how it shows the document again after any change (an Undo, an
// agent's edit); it answers false once the dialog is gone.
let redrawTokens = null;
// The same for the Components dialog.
let redrawComponents = null;

const $ = (id) => document.getElementById(id);
const el = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === "class") node.className = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
};

const MAX_HISTORY_SHOWN = 200;
const STYLE_FIELDS = [
  ["left", "X"], ["top", "Y"], ["width", "Width"], ["height", "Height"],
  ["background", "Fill"], ["color", "Text colour"], ["font-size", "Font size"],
];

const state = {
  client: null,
  user: { actorId: "local-user", displayName: "You" },
  project: null,
  revision: 0,
  document: null,
  selection: [],
  canUndo: false,
  canRedo: false,
  // The agents' changes this person may revert now: each agent's latest change in this session.
  revertible: [],
  history: [],
  seen: new Set(),
  // Layers this editor has just added, to select once the change that adds them is applied:
  // { ids, applied } for the latest insert, marked applied when that change selects them.
  selectOnApply: null,
  // A page just added, to show once the change that adds it is drawn.
  showOnApply: null,
  // The page last shown, where a new layer goes when nothing is selected.
  shownPage: null,
  collapsed: new Set(),
  focusedLayer: null,
  // The align button to focus when the inspector is drawn again after its change.
  focusAlign: null,
  queue: Promise.resolve(),
  events: null,
  confirmations: [],
};
let canvas = null;

/** The roots the Layers panel lists and new layers go into: the design system is not a layer. */
const layerRoots = (doc) => doc.rootIds.filter((id) => doc.nodes[id] && doc.nodes[id].type !== "design-system");

// ---------- status and dialogs ----------

function setStatus(message) {
  $("status").textContent = message;
}

function describeError(error) {
  return error instanceof HostError ? error.message : "Ninerr could not be reached. If it has stopped, start it again and open the new link it gives you.";
}

/** Show a modal dialog; `build(close)` returns its content. Focus returns where it was. */
// The one modal dialog is shared by every flow. Each showing gets a generation, so a flow
// closes only its own dialog, and is told (onReplaced) when another flow takes it over.
let dialogGeneration = 0;
let onDialogReplaced = null;
function showDialog(title, build, { dismissable = true, onReplaced = null } = {}) {
  const dialog = $("dialog");
  const returnFocus = document.activeElement;
  const generation = ++dialogGeneration;
  const replaced = onDialogReplaced;
  onDialogReplaced = onReplaced;
  if (dialog.open) replaced?.();
  const close = () => {
    if (dialogGeneration === generation && dialog.open) dialog.close();
  };
  dialog.replaceChildren(el("h2", { id: "dialog-title" }, title), el("div", { id: "dialog-body" }, build(close)));
  dialog.oncancel = (event) => {
    if (!dismissable) event.preventDefault();
  };
  dialog.onclose = () => {
    if (returnFocus instanceof HTMLButtonElement && (returnFocus.disabled || returnFocus.hidden)) focusLayers();
    else if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  };
  if (!dialog.open) dialog.showModal();
  const first = dialog.querySelector("[autofocus], input, button");
  first?.focus();
  return close;
}

// ---------- projects ----------

async function openProjectsDialog() {
  let projects = [];
  let loadError = null;
  try {
    projects = (await state.client.get("/api/projects")).projects;
  } catch (error) {
    loadError = describeError(error);
  }
  showDialog("Projects", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const name = el("input", { id: "new-project-name", name: "name", required: true, autocomplete: "off", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{0,63}", "aria-describedby": "new-project-hint" });
    const create = el("form", {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        try {
          await state.client.post("/api/projects/create", { name: name.value.trim() });
          close();
          await requestLoad();
        } catch (failure) {
          error.textContent = describeError(failure);
        }
      },
    },
    el("label", { for: "new-project-name" }, "New project name", name),
    el("small", { id: "new-project-hint" }, "Letters, digits, dots, dashes and underscores."),
    el("div", { class: "actions" }, el("button", { type: "submit", class: "primary" }, "Create project")));
    const list = projects.length === 0
      ? el("p", {}, loadError ?? "There are no projects yet.")
      : el("ul", { class: "project-list", "aria-label": "Existing projects" }, projects.map((project) => el("li", {},
        el("button", { type: "button", "data-project": project, onclick: () => openProject(project, error, close) }, project))));
    return [list, create, error, el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close"))];
  });
}

async function openProject(name, errorNode, close, breakStaleLock) {
  errorNode.textContent = "";
  try {
    await state.client.post("/api/projects/open", { name, ...(breakStaleLock ? { breakStaleLock } : {}) });
    close();
    await requestLoad();
  } catch (error) {
    if (error instanceof HostError && error.code === "project-locked") {
      close();
      showLockDialog(name);
    } else {
      errorNode.textContent = describeError(error);
    }
  }
}

function showLockDialog(name) {
  showDialog("This project is open elsewhere", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const reason = el("input", { id: "lock-reason", name: "reason", required: true, autocomplete: "off" });
    return [
      el("p", {}, `“${name}” is locked by another Ninerr session. If that session has crashed or its computer is gone, you can take over the project. The takeover and your reason are recorded with the project.`),
      el("form", {
        novalidate: true,
        onsubmit: async (event) => {
          event.preventDefault();
          if (reason.value.trim() === "") {
            error.textContent = "Give a reason for taking over the project.";
            reason.focus();
            return;
          }
          await openProject(name, error, close, { reason: reason.value.trim() });
        },
      },
      el("label", { for: "lock-reason" }, "Reason for taking over", reason),
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: close }, "Cancel"),
        el("button", { type: "submit", class: "danger" }, "Take over project"))),
      error,
    ];
  });
}

function recoveryNotes(recovery) {
  if (!recovery) return [];
  const notes = [];
  if (recovery.tornTailBytes > 0) notes.push(`An unfinished write at the end of the project's history was discarded (${recovery.tornTailBytes} bytes). Every completed change is intact.`);
  if (recovery.staleTemporaryFiles > 0) notes.push(`${recovery.staleTemporaryFiles} temporary file(s) left by an interrupted save were removed.`);
  if (recovery.legacyProject) notes.push("This project was made before the rename to Ninerr. It was copied into the Ninerr format; the original copy is unchanged next to it.");
  else if (recovery.migratedFrom !== null && recovery.migratedFrom !== undefined) notes.push(`The project was upgraded from format version ${recovery.migratedFrom}.`);
  if (recovery.lockOverride) notes.push(`A stale lock held by ${recovery.lockOverride.previous?.owner ?? "another session"} was taken over: ${recovery.lockOverride.reason}.`);
  return notes;
}

function showRecovery(recovery) {
  const notes = recoveryNotes(recovery);
  if (notes.length === 0) return;
  showDialog("Ninerr recovered this project", (close) => [
    el("ul", { class: "report" }, notes.map((note) => el("li", {}, note))),
    el("div", { class: "actions" }, el("button", { type: "button", class: "primary", onclick: close }, "Continue")),
  ]);
}

function showReopen(message) {
  showDialog("Reopen the project", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    return [
      el("p", {}, message ?? "The project's files changed outside Ninerr or could not be written. Reopen it to continue; every change that was saved is kept."),
      error,
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: () => { close(); openProjectsDialog(); } }, "Projects"),
        el("button", { type: "button", class: "primary", onclick: () => openProject(state.project, error, close) }, "Reopen")),
    ];
  }, { dismissable: false });
}

// ---------- agents and their confirmations ----------

// Why the list of connected agents cannot be used, in the words its cause needs.
function agentsProblem(listing) {
  if (listing.problemCode === "agents-newer") {
    return el("p", { class: "error" }, "The list of connected agents was saved by a newer version of Ninerr. It is left unchanged, so no agent can connect here until that version opens this projects folder again.");
  }
  if (listing.problemCode === "agents-unavailable") {
    return el("p", { class: "error" }, `The list of connected agents could not be read just now (${listing.problem}). It is left unchanged; start Ninerr again to use it.`);
  }
  return el("p", { class: "error" }, `The list of connected agents could not be read (${listing.problem}), so none is connected. Connect them again.`);
}

async function openAgentsDialog() {
  let listing = { agents: [], mcpUrl: "" };
  let loadError = null;
  try {
    listing = await state.client.get("/api/agents");
  } catch (error) {
    if (handleSessionEnded(error)) return;
    loadError = describeError(error);
  }
  showDialog("Agents", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const name = el("input", { id: "agent-name", name: "agentName", autocomplete: "off", maxlength: 60 });
    const problem = !listing.problem ? null : agentsProblem(listing);
    const list = listing.agents.length === 0
      ? el("p", {}, loadError ?? "No agents are connected. A connected agent can read and edit the open project through MCP; every change it makes is attributed to it and can be undone, and it must ask you before deleting anything.")
      : el("ul", { class: "project-list", "aria-label": "Connected agents" }, listing.agents.map((agent) => el("li", { class: "agent-row" },
        el("span", {}, agent.displayName),
        el("button", {
          type: "button",
          class: "danger",
          "aria-label": `Disconnect ${agent.displayName}`,
          onclick: async () => {
            try {
              await state.client.post("/api/agents/revoke", { agentId: agent.agentId });
              close();
              openAgentsDialog();
            } catch (failure) {
              error.textContent = describeError(failure);
            }
          },
        }, "Disconnect"))));
    const form = el("form", {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        try {
          const created = await state.client.post("/api/agents/create", { name: name.value });
          close();
          showAgentCredential(created);
        } catch (failure) {
          error.textContent = describeError(failure);
        }
      },
    },
    el("label", { for: "agent-name" }, "Agent name (for example, the MCP client's name)", name),
    el("div", { class: "actions" }, el("button", { type: "submit", class: "primary" }, "Connect agent")));
    return [problem, list, form, error, el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close"))];
  });
}

function showAgentCredential({ agent, token, mcpUrl }) {
  showDialog(`Connect ${agent.displayName}`, (close) => {
    const credential = el("input", { id: "agent-credential", readonly: true, value: token, "aria-describedby": "agent-credential-note", spellcheck: "false" });
    return [
      el("p", { id: "agent-credential-note" }, "This credential is shown once. Give it to the agent's MCP client; anyone who has it can act as this agent until you disconnect it."),
      el("label", { for: "agent-credential" }, "Agent credential", credential),
      el("p", {}, "For an MCP client that runs a command (stdio), use:"),
      el("pre", { class: "setup" }, "node scripts/ninerr-mcp.mjs --projects <your Ninerr projects folder>\nwith NINERR_MCP_TOKEN set to the credential"),
      el("p", {}, "For an MCP client that connects over HTTP, use this address, with the credential as a Bearer token (it changes each time Ninerr starts):"),
      el("pre", { class: "setup" }, mcpUrl),
      el("div", { class: "actions" }, el("button", { type: "button", class: "primary", onclick: close }, "Done")),
    ];
  });
  $("agent-credential").select();
}

let confirming = null;
let closeConfirmation = null;
function showConfirmations(pending) {
  state.confirmations = pending;
  if (confirming !== null && !pending.some((item) => item.id === confirming)) {
    // The request was withdrawn (it expired, or its agent or project went away).
    confirming = null;
    closeConfirmation?.();
    closeConfirmation = null;
  }
  const next = pending[0];
  if (next === undefined || confirming === next.id) return;
  if ($("dialog").open && confirming === null) {
    // Another dialog is open; ask once it closes.
    $("dialog").addEventListener("close", () => showConfirmations(state.confirmations), { once: true });
    return;
  }
  confirming = next.id;
  closeConfirmation = showDialog(`${next.agentName} asks for your approval`, (close) => {
    const error = el("p", { class: "error", role: "alert" });
    // Close only this request's dialog: by the time the decision is answered, the dialog may
    // already show the next request.
    const finish = () => {
      if (confirming !== next.id) return;
      confirming = null;
      close();
      showConfirmations(state.confirmations);
    };
    const decide = async (approve) => {
      for (const button of $("dialog").querySelectorAll("button")) button.disabled = true;
      try {
        await state.client.post("/api/confirmations/decide", { id: next.id, approve });
        setStatus(approve ? `Approved: ${next.summary}.` : `Declined: ${next.summary}.`);
      } catch (failure) {
        if (!handleSessionEnded(failure)) setStatus(describeError(failure));
      }
      finish();
    };
    return [
      el("p", {}, `The agent ${next.agentName} wants to make a change that needs your approval:`),
      el("p", { class: "request" }, next.summary),
      el("p", {}, "You can revert it afterwards from the history."),
      error,
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: () => decide(false) }, "Decline"),
        el("button", { type: "button", class: "danger", onclick: () => decide(true) }, "Approve")),
    ];
  }, {
    dismissable: false,
    // Another flow took the dialog over: show this request again once that one closes.
    onReplaced: () => {
      confirming = null;
      closeConfirmation = null;
      $("dialog").addEventListener("close", () => showConfirmations(state.confirmations), { once: true });
    },
  });
}

/** What a code import left out of its layers' styles (#370): nothing that changes how they look. */
const styleLeftOutNote = ({ layersWithStyleLeftOut: count }) => count > 0
  ? ` ${count} layer${count === 1 ? " has" : "s have"} style properties left out that a later shorthand in the same style overrides; the source file is not changed.`
  : "";

/** The limit decided in P09 (#369): overlapping properties may draw differently from their source. */
const styleOutOfOrderNote = ({ layersWithStyleOutOfOrder: count }) => count > 0
  ? ` ${count} layer${count === 1 ? " has" : "s have"} overlapping style properties that the canvas applies in its own order, so ${count === 1 ? "it" : "they"} may draw differently from the source.`
  : "";

let selectionTimer = null;
function shareSelection() {
  // MCP's selection reads what is selected here; send it after the selection settles.
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (state.client !== null && state.document !== null) state.client.post("/api/selection", { nodeIds: state.selection }).catch(() => {});
  }, 100);
}

// ---------- research ----------

const REFERENCE_KINDS = ["screen", "flow", "pattern", "asset", "token", "component"];

const rightsText = (rights) => `${rights.status}, ${rights.license ?? "no license stated"}, ${rights.redistributable ? "marked redistributable" : "not redistributable"}`;

const reuseText = ({ allowed }) => (allowed ? "cleared for reuse" : "not cleared for reuse");

/** One reference's metadata and rights. A pack's words are shown as text, and nothing is fetched. */
function referenceDetail({ reference }) {
  const row = (term, value) => [el("dt", {}, term), el("dd", {}, value)];
  return [
    el("h3", {}, reference.title),
    el("dl", {},
      ...row("Kind", reference.kind),
      ...row("Tags", reference.tags.length > 0 ? reference.tags.join(", ") : "None"),
      ...row("Confidence", reference.confidence),
      ...row("Reuse", `${reuseText(reference.reuse)[0].toUpperCase()}${reuseText(reference.reuse).slice(1)}: ${reference.reuse.reason}`),
      ...row("Rights the pack states", rightsText(reference.rights)),
      ...row("Source", reference.source.uri),
      ...row("Source rights the pack states", rightsText(reference.source.rights)),
      ...row("Observed", reference.source.observedAt),
      ...row("Preview", reference.assetSha256 === null ? "This reference has no asset: its metadata is all there is." : `Metadata only. Its asset is not shown here (SHA-256 ${reference.assetSha256}).`)),
  ];
}

/**
 * Search the project's local reference pack (M05), through the functions an agent's search_design_references
 * uses. It works offline: it has no sign-in, follows no link, and shows no image from a pack.
 */
function openResearchDialog() {
  if (state.document === null) return;
  const project = state.project;
  showDialog("Research", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const status = el("p", { id: "research-status", "aria-live": "polite" });
    const results = el("ul", { id: "research-results", class: "project-list" });
    const detail = el("section", { id: "research-detail", tabindex: "-1", "aria-label": "Reference" });
    const folder = el("input", { id: "research-folder", name: "folder", autocomplete: "off", spellcheck: "false", placeholder: "/home/you/reference-packs" });
    const file = el("input", { id: "research-file", name: "file", autocomplete: "off", spellcheck: "false", placeholder: "pack.json" });
    const read = el("button", { type: "submit" }, "Read pack");
    // Not type=search: there Escape clears the field, and does not close the dialog.
    const query = el("input", { id: "research-query", name: "query", autocomplete: "off", maxlength: "200" });
    const kind = el("select", { id: "research-kind", name: "kind" }, el("option", { value: "" }, "All kinds"), ...REFERENCE_KINDS.map((each) => el("option", { value: each }, each)));
    const find = el("button", { type: "submit", class: "primary", id: "research-search" }, "Search");
    // An answer is dropped once a later search, or a later choice of reference, was asked for.
    let searchAsked = 0;
    let shownAsked = 0;
    let readAsked = 0;
    // What a read said, for the first search to land after it.
    let readNote = "";
    /** Whether the dialog's project is still the open one; it closes when it is not. */
    const stillOpen = (answer = null) => {
      if (state.project === project && (answer === null || answer.project === project)) return true;
      close();
      return false;
    };
    const failed = (failure) => {
      if (handleSessionEnded(failure)) return;
      // Another project is open by now: nothing here is its.
      if (failure instanceof HostError && failure.code === "project-changed") close();
      else error.textContent = describeError(failure);
    };
    const show = async (id) => {
      if (!stillOpen()) return;
      const thisOne = ++shownAsked;
      const from = document.activeElement;
      error.textContent = "";
      try {
        const answer = await state.client.get(`/api/references/${encodeURIComponent(id)}`);
        if (thisOne !== shownAsked || !stillOpen(answer)) return;
        detail.replaceChildren(...referenceDetail(answer));
        // Not from someone who has moved on while it was answered.
        if (document.activeElement === from || document.activeElement === document.body) detail.focus({ focusVisible: true });
      } catch (failure) {
        if (thisOne !== shownAsked || !stillOpen()) return;
        // The pack this row came from is gone: the same project opened again starts with none.
        if (failure instanceof HostError && failure.code === "reference-not-found") search();
        else failed(failure);
      }
    };
    const search = async () => {
      if (!stillOpen()) return;
      const thisOne = ++searchAsked;
      shownAsked += 1;
      error.textContent = "";
      const params = new URLSearchParams({ query: query.value, limit: "100" });
      if (kind.value !== "") params.set("kinds", kind.value);
      let answer;
      try {
        answer = await state.client.get(`/api/references?${params}`);
      } catch (failure) {
        if (thisOne !== searchAsked || !stillOpen()) return;
        // No list stands for a search that failed.
        detail.replaceChildren();
        results.replaceChildren();
        status.textContent = readNote.trim();
        readNote = "";
        failed(failure);
        return;
      }
      if (thisOne !== searchAsked || !stillOpen(answer)) return;
      // A row chosen while this search ran belongs to the list it replaces.
      shownAsked += 1;
      detail.replaceChildren();
      const hadFocus = results.contains(document.activeElement);
      results.replaceChildren(...answer.results.map((reference) => el("li", {}, el("button", {
        type: "button",
        "data-id": reference.id,
        onclick: () => show(reference.id),
      }, `${reference.title} (${reference.kind}): ${reuseText(reference.reuse)}`))));
      const count = answer.results.length;
      status.textContent = readNote + (answer.status === "not-loaded"
        ? "No reference pack is read for this project. Read one from a folder on this computer: Ninerr does not look online."
        : count === 0 ? "No reference in this pack matches."
          : count === 100 ? "100 references shown, the most one search gives."
            : `${count} reference${count === 1 ? "" : "s"}.`);
      readNote = "";
      if (hadFocus) (results.querySelector("button") ?? query).focus();
    };
    // Every read is sent: the host keeps the one asked for last, and only its answer shows.
    const readPack = async (event) => {
      event.preventDefault();
      const thisRead = ++readAsked;
      error.textContent = "";
      try {
        const loaded = await state.client.post("/api/references/load", { directory: folder.value.trim(), fileName: file.value.trim() }, { project });
        if (thisRead !== readAsked) return;
        readNote = `Read ${loaded.fileName}: ${loaded.objects} public reference${loaded.objects === 1 ? "" : "s"}. `;
        await search();
      } catch (failure) {
        if (thisRead === readAsked) failed(failure);
      }
    };
    search();
    return [
      el("form", { novalidate: true, onsubmit: readPack },
      el("label", { for: "research-folder" }, "Folder holding a reference pack (its full path)", folder),
      el("label", { for: "research-file" }, "Pack file in that folder", file),
      el("div", { class: "actions" }, read)),
      el("form", {
        novalidate: true,
        role: "search",
        // Every search runs, and the last one asked for is the one that shows.
        onsubmit: (event) => {
          event.preventDefault();
          search();
        },
      },
        el("label", { for: "research-query" }, "Search references", query),
        el("label", { for: "research-kind" }, "Kind", kind),
        el("div", { class: "actions" }, find)),
      error,
      status,
      results,
      detail,
      el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close")),
    ];
  });
}

// ---------- design tokens (ADR-0004) ----------

// The project's design system: collections, modes and tokens. Every change here is one
// transaction, undone by Undo; a rename or a delete reaches every use of the token in it.
function openTokensDialog() {
  showDialog("Tokens", (close) => {
    const error = el("p", { id: "tokens-error", role: "alert" });
    const body = el("div", { id: "tokens-body" });
    // Run one change; the dialog is shown again as the document now is when the change arrives.
    // A refusal is said here, where the person is looking.
    const change = (build, intent) => {
      error.textContent = "";
      let operations;
      try {
        operations = build(state.document);
      } catch (failure) {
        error.textContent = failure.message;
        return;
      }
      commit(operations, intent).then((event) => {
        if (!event) error.textContent = $("status").textContent || "That change was not made.";
      });
    };
    // Which control had focus, so a redraw puts it back on the same one.
    const focusKey = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !body.contains(active)) return null;
      if (active.dataset.token && active.dataset.mode) return `[data-token="${CSS.escape(active.dataset.token)}"][data-mode="${CSS.escape(active.dataset.mode)}"]`;
      if (active.id) return `#${CSS.escape(active.id)}`;
      if (active.getAttribute("aria-label")) return `[aria-label="${CSS.escape(active.getAttribute("aria-label"))}"]`;
      return null;
    };
    const draw = () => {
      if (!body.isConnected && redrawTokens !== null && body.dataset.drawn === "yes") return false;
      const key = focusKey();
      drawBody();
      body.dataset.drawn = "yes";
      if (key !== null) body.querySelector(key)?.focus();
      return true;
    };
    const drawBody = () => {
      const document = state.document;
      const system = document === null ? null : designSystemOf(document);
      if (system === null) {
        const create = el("button", { type: "button", class: "primary", id: "tokens-create" }, "Create design system");
        create.addEventListener("click", () => change((doc) => createDesignSystem(doc, { id: `design-system-${Date.now().toString(36)}` }), "Create design system"));
        body.replaceChildren(el("p", {}, "This project has no design system yet. Its tokens are CSS custom properties that layers use as var(--name)."), el("div", { class: "actions" }, create));
        return;
      }
      const sections = system.props.collections.map((collection) => {
        const tokens = system.props.tokens.filter((token) => token.collection === collection.id);
        const header = el("tr", {}, el("th", { scope: "col" }, "Token"), el("th", { scope: "col" }, "Type"), ...collection.modes.map((mode) => el("th", { scope: "col" }, mode.name)), el("th", { scope: "col" }, "Uses"), el("th", { scope: "col" }, "Actions"));
        const rows = tokens.map((token) => {
          const cells = collection.modes.map((mode) => {
            const input = el("input", { value: token.values[mode.id] ?? "", "aria-label": `${token.name} in ${mode.name}`, spellcheck: "false", "data-token": token.name, "data-mode": mode.id });
            input.addEventListener("change", () => change((doc) => setToken(doc, { name: token.name, values: { [mode.id]: input.value.trim() } }), `Set ${token.name}`));
            return el("td", {}, input);
          });
          const rename = el("button", { type: "button", "aria-label": `Rename ${token.name}` }, "Rename");
          rename.addEventListener("click", () => {
            const field = el("input", { value: token.name, "aria-label": `New name for ${token.name}`, spellcheck: "false" });
            const confirm = el("button", { type: "button", class: "primary" }, "Rename");
            confirm.addEventListener("click", () => change((doc) => renameToken(doc, token.name, field.value.trim()), `Rename ${token.name} to ${field.value.trim()}`));
            rename.replaceWith(field, confirm);
            field.focus();
          });
          const remove = el("button", { type: "button", "aria-label": `Delete ${token.name}` }, "Delete");
          remove.addEventListener("click", () => {
            const uses = tokenUses(state.document, token.name).length;
            const others = system.props.tokens.filter((entry) => entry.name !== token.name);
            const collection = system.props.collections.find((entry) => entry.id === token.collection);
            const choice = el("select", { "aria-label": `What replaces ${token.name} where it is used` },
              el("option", { value: "" }, uses === 0 ? "Nothing (unused)" : "Choose what replaces it"),
              el("option", { value: "literal" }, `Its value: ${token.values[collection.defaultMode] ?? ""} on layers (the default mode), and its own value in each mode for tokens that use it`),
              ...others.map((entry) => el("option", { value: entry.name }, entry.name)));
            const confirm = el("button", { type: "button", class: "primary" }, "Delete");
            confirm.addEventListener("click", () => change((doc) => deleteToken(doc, token.name, choice.value === "literal" ? { literal: true } : choice.value === "" ? undefined : { token: choice.value }), `Delete ${token.name}`));
            remove.replaceWith(choice, confirm);
            choice.focus();
          });
          return el("tr", { "data-token-row": token.name }, el("th", { scope: "row" }, el("code", {}, token.name)), el("td", {}, token.type), ...cells, el("td", {}, String(tokenUses(document, token.name).length)), el("td", {}, rename, remove));
        });
        const modeName = el("input", { "aria-label": `New mode for ${collection.name}`, placeholder: "Mode name, for example Dark" });
        const addModeButton = el("button", { type: "button" }, "Add mode");
        addModeButton.addEventListener("click", () => {
          const name = modeName.value.trim();
          const id = name.toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || `mode-${collection.modes.length + 1}`;
          change((doc) => addMode(doc, collection.id, { id, name }), `Add mode ${name} to ${collection.name}`);
        });
        return el("section", { "aria-label": collection.name },
          el("h3", {}, collection.name),
          el("table", { class: "tokens-table", "data-collection": collection.id }, el("thead", {}, header), el("tbody", {}, ...rows)),
          el("div", { class: "actions" }, modeName, addModeButton));
      });
      const name = el("input", { id: "token-new-name", placeholder: "--brand", spellcheck: "false" });
      const type = el("select", { id: "token-new-type" }, ...TOKEN_TYPES.map((entry) => el("option", { value: entry }, entry)));
      const collectionSelect = el("select", { id: "token-new-collection" }, ...system.props.collections.map((collection) => el("option", { value: collection.id }, collection.name)));
      const value = el("input", { id: "token-new-value", placeholder: "#2255ff, 8px or var(--other)", spellcheck: "false" });
      const add = el("button", { type: "button", class: "primary", id: "token-add" }, "Add token");
      add.addEventListener("click", () => {
        const collection = system.props.collections.find((entry) => entry.id === collectionSelect.value);
        change((doc) => addToken(doc, { name: name.value.trim(), type: type.value, collection: collection.id, values: { [collection.defaultMode]: value.value.trim() } }), `Add ${name.value.trim()}`);
      });
      // A selected layer takes a collection's mode: the canvas draws its tokens in that mode. Each
      // collection's default is chosen apart, and clears that collection's mode alone.
      const selected = state.selection.filter((id) => state.document.nodes[id]);
      const modeChoice = el("select", { id: "token-layer-mode", "aria-label": "Mode for the selected layers" },
        ...system.props.collections.flatMap((collection) => collection.modes.map((mode) => el("option", { value: `${collection.id}:${mode.id === collection.defaultMode ? "" : mode.id}` }, `${collection.name}: ${mode.name}${mode.id === collection.defaultMode ? " (default)" : ""}`))));
      const applyMode = el("button", { type: "button", id: "token-layer-mode-apply", disabled: selected.length === 0 }, "Apply to selected layers");
      applyMode.addEventListener("click", () => change((doc) => {
        // The selection as it is now, not as it was when the dialog was drawn.
        const ids = state.selection.filter((id) => doc.nodes[id]);
        if (ids.length === 0) throw new Error("Select a layer on the canvas first.");
        const [collection, mode] = modeChoice.value.split(":");
        return ids.map((id) => {
          const modes = { ...(doc.nodes[id].props.modes ?? {}) };
          if (mode === "") delete modes[collection];
          else modes[collection] = mode;
          return Object.keys(modes).length === 0 ? { type: "set-props", nodeId: id, unset: ["modes"] } : { type: "set-props", nodeId: id, set: { modes } };
        });
      }, "Set the mode of the selected layers"));
      body.replaceChildren(
        ...sections,
        el("h3", {}, "Add a token"),
        el("div", { class: "token-form" },
          el("label", { for: "token-new-name" }, "Name", name),
          el("label", { for: "token-new-type" }, "Type", type),
          el("label", { for: "token-new-collection" }, "Collection", collectionSelect),
          el("label", { for: "token-new-value" }, "Value", value),
          add),
        el("h3", {}, "Preview a mode"),
        el("p", {}, selected.length === 0 ? "Select a layer on the canvas to give it a mode." : `${selected.length} layer${selected.length === 1 ? "" : "s"} selected.`),
        el("div", { class: "actions" }, modeChoice, applyMode),
      );
    };
    draw();
    redrawTokens = draw;
    return [
      el("p", {}, "Layers use a token by holding var(--name) in a style value, for example color: var(--brand)."),
      error, body,
      tokenCssSection(),
      el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close")),
    ];
  });
}

// Tokens from a CSS file the person chooses, such as Astryx's astryx.css or a theme's theme.css:
// its :root custom properties, light and dark, reviewed first, then added as one change. Values
// Ninerr has no token type for are listed and stay the library's own CSS.
const TOKENS_LISTED = 500;
function tokenCssSection() {
  const section = el("section", { id: "token-css", "aria-labelledby": "token-css-title" }, el("h3", { id: "token-css-title" }, "Import tokens from a CSS file"));
  if (state.client === null || state.project === null) {
    section.append(el("p", {}, "Open a project to import tokens."));
    return section;
  }
  const file = el("input", { id: "token-css-file", type: "file", accept: ".css,text/css" });
  const review = el("button", { type: "button", id: "token-css-review" }, "Review tokens");
  const error = el("p", { id: "token-css-error", role: "alert" });
  const planView = el("div", { id: "token-css-plan" });
  let chosen = null;
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    chosen = picked ? { fileName: picked.name, css: await picked.text() } : null;
    planView.replaceChildren();
    error.textContent = "";
  });
  review.addEventListener("click", async () => {
    error.textContent = "";
    planView.replaceChildren();
    if (chosen === null) {
      error.textContent = "Choose a CSS file first.";
      return;
    }
    const request = chosen;
    let plan;
    try {
      plan = await state.client.post("/api/tokens/css/plan", request);
    } catch (failure) {
      error.textContent = failure.message;
      return;
    }
    const counts = {};
    for (const token of plan.tokens) counts[token.status] = (counts[token.status] ?? 0) + 1;
    const summary = ["new", "extended", "same", "conflict", "refused"].filter((status) => counts[status]).map((status) => `${counts[status]} ${status}`).join(", ");
    const add = el("button", { type: "button", class: "primary", id: "token-css-apply", disabled: plan.adds === 0 || plan.problem !== null }, `Add ${plan.adds} token${plan.adds === 1 ? "" : "s"}`);
    add.addEventListener("click", async () => {
      add.disabled = true;
      try {
        const done = await state.client.post("/api/tokens/css/apply", { ...request, token: plan.token });
        planView.replaceChildren(el("p", { id: "token-css-done" }, `Added ${done.added} token${done.added === 1 ? "" : "s"}. Undo takes them back.`));
      } catch (failure) {
        error.textContent = failure.message;
        add.disabled = false;
      }
    });
    planView.replaceChildren(
      // Only the summary is announced; the lists are there to read.
      el("p", { id: "token-css-summary", role: "status" }, `${plan.source === "astryx" ? "Astryx tokens" : "Tokens"} from ${plan.fileName ?? "the file"}: ${summary || "none"}.${plan.problem ? ` They cannot be added: ${plan.problem}` : ""}`),
      el("ul", { id: "token-css-tokens" }, ...plan.tokens.slice(0, TOKENS_LISTED).map((token) => el("li", {}, `${token.name} (${token.type}): ${token.status}${token.reason ? ` — ${token.reason}` : ""}`))),
      ...(plan.tokens.length > TOKENS_LISTED ? [el("p", { id: "token-css-more" }, `And ${plan.tokens.length - TOKENS_LISTED} more.`)] : []),
      ...(plan.kept.length === 0 ? [] : [
        el("h4", {}, "Kept as the library's CSS"),
        el("ul", { id: "token-css-kept" }, ...plan.kept.map((entry) => el("li", {}, `${entry.name}: ${entry.reason}`))),
      ]),
      el("div", { class: "actions" }, add),
    );
  });
  section.append(el("label", {}, "CSS file", file), el("div", { class: "actions" }, review), error, planView);
  return section;
}

// ---------- components and instances (ADR-0005) ----------

// Make a layer a component, place instances of it, give a component its properties and an
// instance its values, and detach an instance. Every change is one undoable transaction; an
// instance is drawn from its component, so a change to the component reaches every instance.
function openComponentsDialog() {
  showDialog("Components", (close) => {
    const error = el("p", { id: "components-error", role: "alert" });
    const body = el("div", { id: "components-body" });
    const run = (build, intent, select = null) => {
      error.textContent = "";
      let operations;
      try {
        operations = build(state.document);
      } catch (failure) {
        error.textContent = failure.message;
        return;
      }
      commit(operations, intent).then((event) => {
        if (!event) {
          error.textContent = $("status").textContent || "That change was not made.";
          return;
        }
        if (select !== null) selectLayers([select]);
        draw();
      });
    };
    const draw = () => {
      if (body.dataset.drawn === "yes" && !body.isConnected) return false;
      const active = document.activeElement;
      const key = active instanceof HTMLElement && body.contains(active)
        ? (active.dataset.property ? `[data-property="${CSS.escape(active.dataset.property)}"]` : active.id ? `#${CSS.escape(active.id)}` : null)
        : null;
      drawBody();
      body.dataset.drawn = "yes";
      if (key !== null) body.querySelector(key)?.focus();
      return true;
    };
    const drawBody = () => {
      const document = state.document;
      const selected = state.selection.length === 1 ? document.nodes[state.selection[0]] : undefined;
      const parts = [];
      // The selected layer: make it a component, or, for an instance, its values and Detach.
      if (selected?.type === "component-instance") {
        const component = document.nodes[selected.props.componentId];
        parts.push(el("h3", {}, `Instance of ${component ? component.props.name ?? "Unnamed component" : "a missing component"}`));
        for (const property of component?.props?.properties ?? []) {
          const current = selected.props.propertyValues?.[property.id] ?? property.default;
          const label = `${property.name} of this instance`;
          let control;
          if (property.kind === "boolean") control = el("input", { type: "checkbox", checked: current === true, "aria-label": label, "data-property": property.id });
          else if (property.kind === "variant") control = el("select", { "aria-label": label, "data-property": property.id }, ...property.options.map((option) => el("option", { value: option, selected: option === current }, option)));
          // An instance swap or a slot chooses a component: none of the ones it would draw itself in.
          else if (property.kind === "instance-swap" || property.kind === "slot") {
            const fits = componentsFor(document, selected.id);
            const missing = current !== "" && !fits.some((entry) => entry.id === current);
            control = el("select", { "aria-label": label, "data-property": property.id },
              el("option", { value: "", selected: current === "" }, property.kind === "slot" ? "Its own content" : "The component it has"),
              ...(missing ? [el("option", { value: current, selected: true, disabled: true }, "A component that is gone, or would draw this one in itself")] : []),
              ...fits.map((entry) => el("option", { value: entry.id, selected: entry.id === current }, entry.id === property.default ? `${entry.name} (its default)` : entry.name)));
          }
          else control = el("input", { value: String(current), "aria-label": label, "data-property": property.id });
          control.addEventListener("change", () => {
            const value = property.kind === "boolean" ? control.checked : control.value;
            // The instance's values as they are now, not as they were when this was drawn.
            run((doc) => [{ type: "set-props", nodeId: selected.id, set: { propertyValues: { ...(doc.nodes[selected.id]?.props.propertyValues ?? {}), [property.id]: value } } }], `Set ${property.name}`);
          });
          parts.push(el("label", {}, property.name, control));
        }
        const detach = el("button", { type: "button", id: "components-detach" }, "Detach instance");
        detach.addEventListener("click", () => {
          let detached;
          try {
            detached = detachInstance(state.document, selected.id, () => newId("layer"));
          } catch (failure) {
            error.textContent = failure.message;
            return;
          }
          run(() => detached.operations, "Detach instance", detached.rootId);
        });
        // A layer inside it: picked on the canvas by double-click, or here; changed for this
        // instance alone, as its override. Its structure stays the component's.
        const layers = instanceLayers(document, selected.id);
        const current = canvas.target !== null && canvas.target.instanceId === selected.id ? canvas.target : null;
        const keyOf = (target) => JSON.stringify([target.path, target.nodeId]);
        const pick = el("select", { id: "instance-layer", "aria-label": "Layer inside this instance" },
          el("option", { value: "" }, "Choose a layer inside it"),
          ...layers.map((layer) => el("option", { value: keyOf(layer), selected: current !== null && keyOf(current) === keyOf(layer) }, `${"  ".repeat(layer.depth)}${layer.label}`)));
        pick.addEventListener("change", () => {
          if (pick.value === "") canvas.setTarget(null);
          else {
            const [path, nodeId] = JSON.parse(pick.value);
            canvas.setTarget({ instanceId: selected.id, path, nodeId });
          }
        });
        parts.push(el("h3", {}, "A layer inside this instance"), el("label", { for: "instance-layer" }, "Layer", pick));
        if (current !== null) {
          const target = { path: current.path, nodeId: current.nodeId };
          const layer = layers.find((entry) => keyOf(entry) === keyOf(current));
          const set = overrideFor(document, selected.id, target)?.set ?? {};
          const said = Object.entries(set.style ?? {}).map(([name, value]) => `${name}: ${value};`).join(" ");
          const fields = [];
          if (layer?.text !== null && layer?.text !== undefined) {
            const text = el("input", { id: "instance-text", value: layer.text, "aria-label": "Its text in this instance" });
            text.addEventListener("change", () => run((doc) => setInstanceOverride(doc, selected.id, target, { text: text.value }), "Change a layer's text in the instance"));
            fields.push(el("label", { for: "instance-text" }, "Text", text));
          }
          const style = el("textarea", { id: "instance-style", rows: 2, spellcheck: "false", "aria-label": "Its style in this instance, as CSS declarations" }, said);
          style.addEventListener("change", () => run((doc) => {
            const wanted = parseDeclarations(style.value, overrideFor(doc, selected.id, target)?.set?.style ?? {});
            // Each property set before and now gone is taken off.
            const cleared = Object.fromEntries(Object.keys(overrideFor(doc, selected.id, target)?.set?.style ?? {}).filter((name) => !Object.hasOwn(wanted, name)).map((name) => [name, ""]));
            return setInstanceOverride(doc, selected.id, target, { style: { ...cleared, ...wanted } });
          }, "Change a layer's style in the instance"));
          // As the instance draws it now (a variant or a property may have hidden it); the person's
          // choice is the last word, so it can show what a variant hid.
          const shown = el("input", { id: "instance-shown", type: "checkbox", checked: layer ? !layer.hidden : set.visible !== false });
          shown.addEventListener("change", () => run((doc) => setInstanceOverride(doc, selected.id, target, { visible: shown.checked }), shown.checked ? "Show a layer in the instance" : "Hide a layer in the instance"));
          const reset = el("button", { type: "button", id: "instance-reset-layer", disabled: Object.keys(set).length === 0 }, "Reset this layer");
          reset.addEventListener("click", () => run((doc) => resetInstance(doc, selected.id, target), "Reset a layer in the instance"));
          const main = el("button", { type: "button", id: "instance-edit-main" }, "Edit main component");
          // The component's own layer, selected as a layer: what changes there reaches every instance.
          main.addEventListener("click", () => {
            canvas.setTarget(null);
            selectLayers([layer?.mainId ?? current.nodeId]);
            close();
            setStatus("Editing the main component: changes reach every instance.");
          });
          fields.push(
            el("label", { for: "instance-style" }, "Style (for example color: red; padding: 4px)", style),
            el("label", { for: "instance-shown" }, shown, " Shown in this instance"),
            el("div", { class: "actions" }, reset, main));
          parts.push(...fields);
        }
        const resetAll = el("button", { type: "button", id: "instance-reset", disabled: (selected.props.overrides ?? []).length === 0 }, "Reset all its overrides");
        resetAll.addEventListener("click", () => run((doc) => resetInstance(doc, selected.id), "Reset the instance's overrides"));
        parts.push(el("div", { class: "actions" }, detach, resetAll));
      } else if (selected?.type === "component-definition") {
        parts.push(el("h3", {}, `Component ${selected.props.name ?? "Unnamed component"}`));
        const layers = [];
        const walk = (id, depth) => {
          const node = document.nodes[id];
          if (!node) return;
          layers.push({ id, label: `${"  ".repeat(depth)}${node.props.name ?? node.props.tag ?? node.type}` });
          for (const child of node.children) walk(child, depth + 1);
        };
        walk(selected.id, 0);
        const name = el("input", { id: "property-name", placeholder: "Label" });
        const kind = el("select", { id: "property-kind" }, el("option", { value: "text" }, "Text"), el("option", { value: "boolean" }, "Shown (true or false)"), el("option", { value: "variant" }, "Variant (a class)"), el("option", { value: "instance-swap" }, "Swap a nested instance's component"), el("option", { value: "slot" }, "Slot (a component put in a layer)"));
        const options = el("input", { id: "property-options", placeholder: "Variant options, comma-separated: sm, md, lg" });
        const target = el("select", { id: "property-target" }, ...layers.map((layer) => el("option", { value: layer.id }, layer.label)));
        const add = el("button", { type: "button", class: "primary", id: "property-add" }, "Add property");
        add.addEventListener("click", () => run((doc) => {
          const component = doc.nodes[selected.id];
          const label = name.value.trim();
          if (label === "") throw new Error("Name the property.");
          // An id no property of this component has, now or before: ids are never reused.
          const taken = new Set((component.props.properties ?? []).map((property) => property.id));
          const stem = `p-${label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "property"}`;
          let id = stem;
          for (let at = 2; taken.has(id); at += 1) id = `${stem}-${at}`;
          const choices = [...new Set(options.value.split(",").map((entry) => entry.trim()).filter(Boolean))];
          if (kind.value === "variant" && choices.length === 0) throw new Error("Give the variant its options, for example: sm, md, lg.");
          const chosen = doc.nodes[target.value];
          if (kind.value === "instance-swap" && chosen?.type !== "component-instance") throw new Error("An instance swap targets an instance inside the component.");
          if (kind.value === "slot" && chosen?.type === "component-instance") throw new Error("A slot is a layer that holds what is put in it, not an instance.");
          const property = kind.value === "instance-swap" || kind.value === "slot"
            ? { id, name: label, kind: kind.value, default: "", target: { nodeId: target.value, field: "children" } }
            : kind.value === "boolean"
            ? { id, name: label, kind: "boolean", default: true, target: { nodeId: target.value, field: "visible" } }
            : kind.value === "variant"
              ? { id, name: label, kind: "variant", default: choices[0] ?? "", options: choices, target: { nodeId: target.value, field: "attributes.class" } }
              : { id, name: label, kind: "text", default: doc.nodes[target.value]?.props?.text ?? "", target: { nodeId: target.value, field: "text" } };
          // A component from before schema 2 gets its name with its first property.
          return [{ type: "set-props", nodeId: selected.id, set: { name: typeof component.props.name === "string" && component.props.name !== "" ? component.props.name : "Component", properties: [...(component.props.properties ?? []), property] } }];
        }, `Add property ${name.value.trim()}`));
        parts.push(
          el("p", {}, `${(selected.props.properties ?? []).length} propert${(selected.props.properties ?? []).length === 1 ? "y" : "ies"}: ${(selected.props.properties ?? []).map((property) => property.name).join(", ") || "none yet"}.`),
          el("div", { class: "token-form" },
            el("label", { for: "property-name" }, "Name", name),
            el("label", { for: "property-kind" }, "Kind", kind),
            el("label", { for: "property-options" }, "Options", options),
            el("label", { for: "property-target" }, "Layer it sets", target),
            add),
        );
      } else if (selected) {
        const name = el("input", { id: "component-name", value: selected.props.name ?? "", placeholder: "Component name" });
        const make = el("button", { type: "button", class: "primary", id: "component-create" }, "Make it a component");
        make.addEventListener("click", () => {
          const id = newId("component");
          run((doc) => createComponent(doc, selected.id, { id, name: name.value }), `Make ${name.value.trim() || "a component"}`, id);
        });
        parts.push(el("h3", {}, "The selected layer"), el("label", { for: "component-name" }, "Name", name), el("div", { class: "actions" }, make));
      } else {
        parts.push(el("p", {}, "Select a layer to make it a component, a component to give it properties, or an instance to set its values."));
      }
      // Every component: place an instance after the selection.
      const components = componentsOf(document);
      parts.push(el("h3", {}, "Components"));
      if (components.length === 0) parts.push(el("p", {}, "None yet."));
      else {
        parts.push(el("ul", { class: "project-list", id: "components-list" }, components.map((component) => {
          const insert = el("button", { type: "button", "aria-label": `Insert an instance of ${component.name}` }, "Insert instance");
          insert.addEventListener("click", () => {
            const id = newId("instance");
            run((doc) => insertInstance(doc, component.id, { id, afterId: state.selection[0] ?? null }), `Insert ${component.name}`, id);
          });
          return el("li", { class: "codebase-row" }, el("span", {}, el("strong", {}, component.name)), insert);
        })));
      }
      body.replaceChildren(...parts);
    };
    draw();
    redrawComponents = draw;
    return [error, body, el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close"))];
  });
}

// ---------- curated UI component sources ----------

// What each import policy lets a person do with a source's items, in the catalog's words.
const IMPORT_POLICY_TEXT = {
  "allowed": "Its items may be imported into your own project, keeping their license notice.",
  "allowed-with-attribution": "Its items may be imported into your own project, which must then show the credit link its license requires.",
  "free-items-only": "Only its free items may be imported. Pro items need your own license and are never offered by Ninerr.",
  "permission-required": "Ninerr imports nothing from it: its terms need the publisher's written permission.",
};

// Discovery is local-only. Selecting a source does not fetch or execute code or
// grant any redistribution rights. Each chosen component still needs review.
function openComponentSourcesDialog() {
  showDialog("Component sources", (close) => {
    const query = el("input", {
      id: "component-source-query", name: "query", maxlength: "200",
      autocomplete: "off", placeholder: "Search libraries and capabilities",
    });
    const group = el("select", { id: "component-source-group", name: "group" },
      ...UI_COMPONENT_SOURCE_GROUPS.map((name) => el("option", { value: name }, name)));
    const count = el("p", { id: "component-source-count", role: "status", "aria-live": "polite" });
    const results = el("ul", { id: "component-source-results", class: "project-list" });
    const detail = el("section", { id: "component-source-detail", "aria-label": "Selected source" });
    const field = (label, value) => el("label", {}, label,
      el("textarea", { readonly: true, rows: 2, spellcheck: "false" }, value));
    const show = (source) => {
      detail.replaceChildren(
        el("h3", {}, source.name),
        el("p", {}, source.purpose),
        el("p", {}, source.usage),
        el("p", {}, "License: " + source.license),
        el("p", { "data-import-policy": source.importPolicy }, IMPORT_POLICY_TEXT[source.importPolicy]),
        el("p", {}, "Rights: " + source.rights),
        el("p", {}, "Review gate: " + source.gate),
        field("Official website", source.website),
        field("Source or documentation", source.source),
        field("Setup example (run only in a compatible, reviewed React project)", source.install),
        ...(RECORD_SOURCES.includes(source.id) ? [sourceComponentsSection(source)] : []),
      );
    };
    const search = () => {
      const entries = searchUiComponentSources({ query: query.value, group: group.value });
      results.replaceChildren(...entries.map((source) =>
        el("li", {}, el("button", { type: "button", "data-source-id": source.id, onclick: () => show(source) }, source.name + " — " + source.group))));
      count.textContent = entries.length === 0
        ? "No matching source." : entries.length + " source" + (entries.length === 1 ? "" : "s") + ".";
      detail.replaceChildren();
    };
    query.addEventListener("input", search);
    group.addEventListener("change", search);
    search();
    return [
      el("p", {}, "Curated React component sources. This catalog works offline: nothing is installed or fetched. Records of Astryx's components, at a pinned commit, come with Ninerr."),
      el("label", { for: "component-source-query" }, "Find source", query),
      el("label", { for: "component-source-group" }, "Category", group),
      count, results, detail,
      componentImportSection(close),
      el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close")),
    ];
  });
}

// The components of a source Ninerr has records for (Astryx): found by name or purpose, each with
// its props, variants, accessibility notes, limitations and where its record came from. The
// records are local and pinned; they load when the section opens.
const RECORDS_SHOWN = 50;
function sourceComponentsSection(source) {
  const status = el("p", { id: "source-components-status", role: "status", "aria-live": "polite" }, "Loading its component records…");
  const section = el("section", { id: "source-components", "aria-labelledby": "source-components-title" },
    el("h4", { id: "source-components-title" }, `${source.name} components`), status);
  loadComponentRecords(source.id).then((snapshot) => {
    const query = el("input", { id: "source-component-query", maxlength: "200", autocomplete: "off", placeholder: "A name or a purpose, such as date picker" });
    const categories = [...new Set(snapshot.components.map((record) => record.category).filter(Boolean))].sort();
    const category = el("select", { id: "source-component-category" }, el("option", { value: "" }, "All categories"), ...categories.map((name) => el("option", { value: name }, name)));
    const list = el("ul", { id: "source-component-results", class: "project-list" });
    const detail = el("div", { id: "source-component-detail" });
    const from = `${snapshot.package.name} ${snapshot.package.version}, commit ${snapshot.commit.slice(0, 12)}`;
    const show = (record) => detail.replaceChildren(
      el("h5", {}, record.name),
      el("p", {}, record.description),
      el("p", {}, `Import: ${record.importPath ?? "a part of " + (record.subComponentOf ?? "another component")}. ${record.rendering === "client" ? "Needs React on the client for its behaviour." : "Renders without client script."}`),
      ...(record.props.length === 0 ? [] : [el("table", { id: "source-component-props" },
        el("caption", {}, `${record.name} props`),
        el("thead", {}, el("tr", {}, ...["Prop", "Type", "Required", "Default"].map((name) => el("th", { scope: "col" }, name)))),
        el("tbody", {}, ...record.props.map((prop) => el("tr", {}, el("th", { scope: "row" }, prop.name), el("td", {}, prop.type), el("td", {}, prop.required ? "yes" : "no"), el("td", {}, prop.default ?? "")))))]),
      ...(record.accessibility.length === 0 ? [] : [el("h6", {}, "Accessibility"), el("ul", {}, ...record.accessibility.map((item) => el("li", {}, `${item.name}${item.criterion ? ` (${item.criterion}${item.requirement ? `, ${item.requirement}` : ""})` : ""}: ${item.description}`)))]),
      ...(record.limitations.length === 0 ? [] : [el("h6", {}, "Limitations"), el("ul", {}, ...record.limitations.map((text) => el("li", {}, text)))]),
      el("p", { id: "source-component-provenance" }, `From ${record.doc.path} in ${from}. ${snapshot.license.spdx}, ${snapshot.license.copyright.replace(/\.?$/u, ".")}`),
    );
    const run = () => {
      const found = searchComponents(snapshot.components, { query: query.value, category: category.value === "" ? null : category.value, limit: RECORDS_SHOWN });
      list.replaceChildren(...found.map((record) => el("li", {}, el("button", { type: "button", "data-component-id": record.id, onclick: () => show(record) }, record.category ? `${record.name} — ${record.category}` : record.name))));
      status.textContent = found.length === 0 ? `No matching component in ${from}.` : `${found.length === RECORDS_SHOWN ? `The first ${RECORDS_SHOWN}` : found.length} matching component${found.length === 1 ? "" : "s"}, from ${from}.`;
      detail.replaceChildren();
    };
    query.addEventListener("input", run);
    category.addEventListener("change", run);
    section.append(el("label", {}, "Find a component", query), el("label", {}, "Component category", category), list, detail);
    run();
  }, (error) => {
    status.textContent = `Its component records could not be loaded: ${error.message}`;
  });
  return section;
}

// A registry item the person chose, into the connected codebase (#405). The item is a file they
// pick or text they paste: Ninerr fetches nothing. The host plans the import, the person reads
// every file it would create, and only then are new files created; none is ever replaced.
function componentImportSection(close) {
  const section = el("section", { id: "component-import", "aria-labelledby": "component-import-title" },
    el("h3", { id: "component-import-title" }, "Import a registry item"));
  if (state.client === null || state.project === null) {
    section.append(el("p", {}, "Open a project and connect its codebase in Code to import an item."));
    return section;
  }
  const project = state.project;
  const file = el("input", { id: "component-item-file", type: "file", accept: ".json,application/json" });
  const text = el("textarea", { id: "component-item-text", rows: 4, spellcheck: "false", placeholder: "Or paste the item's JSON" });
  const url = el("input", { id: "component-item-url", type: "url", maxlength: "2048", autocomplete: "off", placeholder: "https://… (where the item came from, optional)" });
  const free = el("input", { id: "component-item-free", type: "checkbox" });
  // The item's CSS variables become design tokens unless the person says not to.
  const addTokens = el("input", { id: "component-item-tokens", type: "checkbox", checked: true });
  const review = el("button", { type: "button", id: "component-import-review" }, "Review import");
  const error = el("p", { id: "component-import-error", role: "alert" });
  const planView = el("div", { id: "component-import-plan", "aria-live": "polite" });
  let fileName = null;
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    fileName = chosen.name;
    text.value = await chosen.text();
    planView.replaceChildren();
  });
  // A plan is for the choices it was made with: changing one takes it down, to be reviewed again.
  for (const control of [text, url, free, addTokens]) control.addEventListener("change", () => planView.replaceChildren());
  text.addEventListener("input", () => planView.replaceChildren());
  const request = () => ({
    item: text.value,
    origin: url.value.trim() !== "" ? { url: url.value.trim() } : fileName !== null ? { fileName } : undefined,
    freeItemConfirmed: free.checked,
    addTokens: addTokens.checked,
  });
  const list = (id, label, items) => items.length === 0 ? [] : [el("p", {}, label), el("ul", { id }, items.map((entry) => el("li", {}, entry)))];
  const bringIn = (written) => el("ul", { class: "project-list", id: "component-import-components", "aria-label": "Components the import created" }, written.components.map(({ file: path, component }) => {
    const bring = el("button", { type: "button", "aria-label": `Bring in ${component} from ${path}` }, "Bring in");
    bring.addEventListener("click", () => {
      bring.disabled = true;
      enqueue(async () => {
        try {
          const result = await state.client.post("/api/codebase/import", { file: path, component }, { project });
          close();
          applyChange(result);
          selectLayers([result.frameId]);
          canvas.fit();
          renderToolbar();
          setStatus(`${result.intent}: ${result.layers} layers added.${styleLeftOutNote(result)}${styleOutOfOrderNote(result)}`);
        } catch (failure) {
          bring.disabled = false;
          if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
        }
      });
    });
    return el("li", { class: "codebase-row" }, el("span", {}, el("strong", {}, component), ` ${path}`), bring);
  }));
  const show = (plan, body) => {
    const install = plan.dependencies.missing.map(({ name, range }) => (range === null ? name : `${name}@${range}`));
    const newFiles = plan.files.filter((entry) => entry.status === "new").length;
    const newTokens = plan.designTokens.filter((entry) => entry.status === "new").length;
    const create = el("button", { type: "button", class: "primary", id: "component-import-apply", disabled: !plan.appliable },
      newFiles > 0 ? `Create ${newFiles} file${newFiles === 1 ? "" : "s"}${body.addTokens && newTokens > 0 ? ` and add ${newTokens} token${newTokens === 1 ? "" : "s"}` : ""}` : `Add ${newTokens} token${newTokens === 1 ? "" : "s"}`);
    create.addEventListener("click", () => {
      create.disabled = true;
      error.textContent = "";
      enqueue(async () => {
        try {
          const written = await state.client.post("/api/components/apply", { ...body, token: plan.token }, { project });
          if (written.tokens) applyChange(written.tokens);
          const filesSaid = written.written.length === 0 ? "No new files." : `Created ${written.written.length} file${written.written.length === 1 ? "" : "s"}: ${written.written.join(", ")}.`;
          const tokensSaid = written.tokens
            ? ` ${written.tokens.intent}: Undo takes the tokens back, but not the files; delete those yourself if you change your mind.`
            : written.tokenError ? ` Its tokens were not added: ${written.tokenError}` : written.written.length > 0 ? " Undo does not remove files; delete them yourself if you change your mind." : "";
          planView.replaceChildren(
            el("p", { id: "component-import-done", role: written.tokenError ? "alert" : null }, filesSaid + tokensSaid),
            ...(written.components.length === 0 ? [] : [bringIn(written)]),
          );
          setStatus(written.tokens ? `Imported ${plan.item.name}: ${written.tokens.intent}.` : `Imported ${plan.item.name} into the codebase.`);
        } catch (failure) {
          create.disabled = false;
          if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
        }
      });
    });
    planView.replaceChildren(
      el("h4", {}, plan.item.title ?? plan.item.name),
      el("p", {}, `From ${plan.origin}.`),
      el("p", { id: "component-import-decision" }, plan.decision.reason),
      ...(plan.decision.attribution ? [el("p", {}, `Your project must show a visible link to ${plan.decision.attribution}.`)] : []),
      el("p", {}, `Primitive family: ${plan.primitives.family}. Project: ${plan.project.family}. Folders from ${plan.project.layoutFrom}.`),
      el("ul", { id: "component-import-files", "aria-label": "Files the import would create" }, plan.files.map((entry) => el("li", { "data-status": entry.status }, `${entry.path} (${entry.status === "new" ? "new" : entry.status === "same" ? "already there" : "exists with other content"})`))),
      ...list("component-import-dependencies", "Packages to add with your package manager (Ninerr installs nothing):", install),
      ...list("component-import-registry", "Other items it needs, to import the same way:", [...plan.registryDependencies]),
      ...list("component-import-tokens", "Design tokens it defines:", plan.designTokens.map((entry) => `${entry.name} (${entry.type}): ${entry.status === "new" ? "new" : entry.status === "same" ? "already in the design system" : entry.status === "extended" ? "already there; its missing modes are added" : entry.status === "conflict" ? "kept: the design system has another value" : `refused: ${entry.reason}`}`)),
      ...list("component-import-blockers", "This import cannot go ahead:", plan.blockers),
      ...(plan.appliable || plan.blockers.length > 0 ? [] : [el("p", { id: "component-import-nothing" }, body.addTokens ? "Nothing new to import: its files and tokens are already there." : "Nothing new to import: its files are already there, and adding its tokens is off.")]),
      el("div", { class: "actions" }, create),
    );
  };
  review.addEventListener("click", () => {
    error.textContent = "";
    planView.replaceChildren();
    if (text.value.trim() === "") {
      error.textContent = "Choose an item file or paste its JSON first.";
      return;
    }
    review.disabled = true;
    const body = request();
    enqueue(async () => {
      try {
        show(await state.client.post("/api/components/plan", body, { project }), body);
      } catch (failure) {
        if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
      } finally {
        review.disabled = false;
      }
    });
  });
  section.append(
    el("p", {}, "Choose a registry item (shadcn registry JSON) you saved from a source whose license allows it. Ninerr shows every file it would create in your connected codebase before writing, and never replaces a file."),
    el("label", { for: "component-item-file" }, "Item file", file),
    el("label", { for: "component-item-text" }, "Item JSON", text),
    el("label", { for: "component-item-url" }, "Came from", url),
    el("label", { for: "component-item-free" }, free, " It is a free item (for sources that license only their free items)"),
    el("label", { for: "component-item-tokens" }, addTokens, " Add its new design tokens to the project's design system"),
    el("div", { class: "actions" }, review),
    error, planView,
  );
  return section;
}

// ---------- importing ----------

// The import stack's offline limit for one HTML page.
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function openImportDialog() {
  if (state.document === null) return;
  // The project this dialog imports into: a click after another tab opened a different one is refused (#260).
  const project = state.project;
  showDialog("Import HTML", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    // The page, and the stylesheet files it links to (#283): nothing it links to is fetched.
    const file = el("input", { id: "import-file", type: "file", multiple: true, accept: ".html,.htm,.css,text/html,text/css" });
    const pasted = el("textarea", { id: "import-html", rows: 6, spellcheck: "false", placeholder: "<main>…</main>" });
    const form = el("form", {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        let html = pasted.value;
        let name = "Pasted HTML";
        const files = [...(file.files ?? [])];
        const pages = files.filter((entry) => /\.html?$/iu.test(entry.name));
        if (pages.length > 1) {
          error.textContent = "Choose one HTML page, with the stylesheet files it links to.";
          return;
        }
        const chosen = pages[0] ?? null;
        const sheets = files.filter((entry) => /\.css$/iu.test(entry.name));
        if (sheets.reduce((total, entry) => total + entry.size, 0) > MAX_IMPORT_BYTES) {
          error.textContent = "Those stylesheets are larger than 2 MiB in all, the most Ninerr imports at once.";
          return;
        }
        const stylesheets = await Promise.all(sheets.map(async (entry) => ({ name: entry.name, css: await entry.text() })));
        if (chosen) {
          if (chosen.size > MAX_IMPORT_BYTES) {
            error.textContent = "That file is larger than 2 MiB, the most Ninerr imports at once.";
            return;
          }
          html = await chosen.text();
          name = chosen.name.replace(/\.html?$/iu, "") || "Imported page";
        }
        if (html.trim() === "") {
          error.textContent = "Choose an HTML file or paste HTML.";
          return;
        }
        try {
          const review = await state.client.post("/api/import", { html, name, ...(stylesheets.length === 0 ? {} : { stylesheets }) }, { project });
          close();
          showImportReview(review, project);
        } catch (failure) {
          if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
        }
      },
    },
    el("p", {}, "Ninerr reads the HTML on this computer and removes scripts, event handlers and unsafe links. Nothing it links to is fetched. You review the result before anything is added."),
    el("label", { for: "import-file" }, "HTML file, with the stylesheet files it links to", file),
    el("label", { for: "import-html" }, "Or paste HTML", pasted),
    el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Cancel"), el("button", { type: "submit", class: "primary" }, "Review import")));
    return [form, error];
  });
}

function showImportReview(review, project) {
  const KINDS = { scriptsRemoved: "script", eventHandlersRemoved: "event handler", dangerousUrlsRemoved: "unsafe link", dangerousElementsRemoved: "unsafe element", unsafeStylesRemoved: "unsafe style" };
  const removed = Object.entries(review.security).filter(([kind, count]) => count > 0 && Object.hasOwn(KINDS, kind)).map(([kind, count]) => `${count} ${KINDS[kind]}${count === 1 ? "" : "s"} removed`);
  showDialog(`Review import: ${review.name}`, (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const discard = async () => {
      close();
      await state.client.post("/api/import/discard", { proposalId: review.proposalId }, { project }).catch(() => {});
    };
    const commit = () => enqueue(async () => {
      try {
        const event = await state.client.post("/api/import/commit", { proposalId: review.proposalId }, { project });
        close();
        applyChange(event);
        selectLayers([event.frameId]);
        canvas.fit();
        renderToolbar();
        setStatus(`${event.intent}: ${review.counts.nodes} layers added.`);
      } catch (failure) {
        // The review is kept when a commit fails, so Import can be pressed again; a project
        // that must be reopened is handled as for any edit.
        if (failure instanceof HostError && failure.code === "project-needs-reopen") {
          close();
          handleEditError(failure);
        } else if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
      }
    });
    return [
      el("ul", { class: "report", id: "import-review" },
        el("li", {}, `${review.counts.nodes} layers in ${review.counts.roots} top-level group${review.counts.roots === 1 ? "" : "s"}`),
        removed.length > 0 ? el("li", {}, `For safety: ${removed.join(", ")}`) : el("li", {}, "Nothing unsafe was found."),
        review.accessibilityFindings > 0 ? el("li", {}, `${review.accessibilityFindings} accessibility finding${review.accessibilityFindings === 1 ? "" : "s"} to look at after importing`) : null,
        review.notes.map((note) => el("li", {}, note)),
        review.blockingReasons.map((reason) => el("li", { class: "error" }, `Cannot import: ${reason}`))),
      error,
      el("div", { class: "actions" },
        el("button", { type: "button", onclick: discard }, "Discard"),
        el("button", { type: "button", class: "primary", disabled: !review.commitReady, onclick: commit }, "Import")),
    ];
  }, { dismissable: false });
}

// ---------- design and code ----------

async function openCodeDialog() {
  if (state.document === null) return;
  // The project this dialog changes: a click after another tab opened a different one is refused (#260).
  const project = state.project;
  const selected = state.selection.length === 1 ? state.selection[0] : null;
  let exported = null;
  let exportError = null;
  if (selected !== null) {
    try {
      exported = await state.client.post("/api/code/export", { nodeId: selected });
    } catch (error) {
      if (handleSessionEnded(error)) return;
      exportError = describeError(error);
    }
  }
  // The connected codebase (PC11): its folder and components, if one is connected.
  let codebase = null;
  let codebaseError = null;
  try {
    codebase = await state.client.get("/api/codebase");
  } catch (error) {
    if (handleSessionEnded(error)) return;
    codebaseError = describeError(error);
  }
  // The selected layer's source in the codebase, if it came from there.
  const boundNode = (() => {
    if (selected === null) return null;
    const doc = state.document;
    const stack = [selected];
    while (stack.length > 0) {
      const node = doc.nodes[stack.pop()];
      if (!node) continue;
      if (node.props?.codeSource && typeof node.props.codeSource.file === "string") return node;
      stack.push(...node.children);
    }
    return null;
  })();
  showDialog("Design and code", (close) => {
    const error = el("p", { class: "error", role: "alert" });
    const codebasePart = buildCodebasePart({ codebase, codebaseError, boundNode, close, error, project });
    const output = exported === null ? null : el("textarea", { id: "code-export", rows: 10, readonly: true, spellcheck: "false", "aria-describedby": "code-export-note" });
    if (output) output.value = exported.code;
    const source = el("textarea", { id: "code-import", rows: 8, spellcheck: "false", placeholder: "export function Card() {\n  return <section>…</section>;\n}" });
    const exportPart = exported === null
      ? el("p", {}, exportError ?? "Select one layer to see it as code.")
      : [
        el("p", { id: "code-export-note" }, `The selected layer (${exported.layers} layer${exported.layers === 1 ? "" : "s"}) as the JSX component ${exported.componentName}, as the canvas draws it.${exported.codeParts > 0 ? ` ${exported.codeParts} {…} part${exported.codeParts === 1 ? " is" : "s are"} code copied exactly from this design's source: not checked or sanitized, and using names that must exist where you run it. Review before running.` : ""}`),
        el("label", { for: "code-export" }, "JSX", output),
        el("div", { class: "actions" }, el("button", { type: "button", onclick: async () => {
          try {
            await navigator.clipboard.writeText(exported.code);
            setStatus("Code copied.");
          } catch {
            output.select();
            setStatus("Select the code and copy it.");
          }
        } }, "Copy code"),
        // The same layer as a standalone page: its markup, its tokens and its page's stylesheet.
        el("button", { type: "button", id: "code-export-html", onclick: async () => {
          let page;
          try {
            page = await state.client.post("/api/code/export-html", { nodeId: selected });
          } catch (failure) {
            if (handleSessionEnded(failure)) return;
            error.textContent = describeError(failure);
            return;
          }
          try {
            await navigator.clipboard.writeText(page.html);
            setStatus(`HTML page copied: ${page.layers} layer${page.layers === 1 ? "" : "s"}${page.codeParts > 0 ? `, ${page.codeParts} {…} part${page.codeParts === 1 ? "" : "s"} written as comments` : ""}.`);
          } catch {
            output.value = page.html;
            output.select();
            setStatus("The HTML page is in the code box: select it and copy it.");
          }
        } }, "Copy as an HTML page"),
        // The same JSX with its styles as Tailwind classes: each one says exactly what the style did.
        el("button", { type: "button", id: "code-export-tailwind", onclick: async () => {
          let styled;
          try {
            styled = await state.client.post("/api/code/export-tailwind", { nodeId: selected });
          } catch (failure) {
            if (handleSessionEnded(failure)) return;
            error.textContent = describeError(failure);
            return;
          }
          const kept = styled.stylesheetApplies ? "; styles kept inline, since the page's stylesheet applies to these layers" : styled.keptAsStyle > 0 ? `; ${styled.keptAsStyle} declaration${styled.keptAsStyle === 1 ? "" : "s"} kept as style, where a class would not say exactly the same` : "";
          try {
            await navigator.clipboard.writeText(styled.code);
            setStatus(`Tailwind code copied: ${styled.classes} class${styled.classes === 1 ? "" : "es"}${kept}.`);
          } catch {
            output.value = styled.code;
            output.select();
            setStatus(`The Tailwind code is in the code box: select it and copy it${kept}.`);
          }
        } }, "Copy with Tailwind classes")),
        // The stylesheet that applies to it (#283), which the canvas applies to its frame alone.
        ...(typeof exported.stylesheet === "string" ? [(() => {
          const sheet = el("textarea", { id: "code-export-css", rows: 6, readonly: true, spellcheck: "false" });
          sheet.value = exported.stylesheet;
          return el("label", { for: "code-export-css" }, "Its stylesheet (on the canvas, applied to its frame alone; :scope is the frame)", sheet);
        })()] : []),
        // The design tokens its var() values use (ADR-0004), compiled for the code's global CSS.
        ...(typeof exported.tokens === "string" ? [(() => {
          const sheet = el("textarea", { id: "code-export-tokens", rows: 6, readonly: true, spellcheck: "false" });
          sheet.value = exported.tokens;
          return el("label", { for: "code-export-tokens" }, "The design tokens it uses (add to your global CSS)", sheet);
        })()] : []),
      ];
    const importForm = el("form", {
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        error.textContent = "";
        if (source.value.trim() === "") {
          error.textContent = "Paste a JSX function component.";
          return;
        }
        enqueue(async () => {
          try {
            const result = await state.client.post("/api/code/import", { code: source.value }, { project });
            close();
            applyChange(result);
            selectLayers([result.frameId]);
            canvas.fit();
            renderToolbar();
            setStatus(`${result.intent}: ${result.layers} layers added.${styleLeftOutNote(result)}${styleOutOfOrderNote(result)}`);
          } catch (failure) {
            if (failure instanceof HostError && failure.code === "project-needs-reopen") {
              close();
              handleEditError(failure);
            } else if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
          }
        });
      },
    },
    el("h3", {}, "Bring code into the design"),
    el("label", { for: "code-import" }, "A JSX function component (elements, text, literal props, className, and a style string or style object)", source),
    el("div", { class: "actions" }, el("button", { type: "submit", class: "primary" }, "Add to design")));
    return [el("h3", {}, "Selected layer as code"), exportPart, importForm, codebasePart, error, el("div", { class: "actions" }, el("button", { type: "button", onclick: close }, "Close"))];
  });
}

/** The first line of a write-back plan's review: what writing it would do. */
function planSummary(plan) {
  if (plan.changes.length > 0) return `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"} to ${plan.file}:`;
  const one = plan.matched.length === 1;
  if (plan.matched.length > 0) return `Nothing needs writing: ${plan.matched.length} field${one ? " has" : "s have"} the same value here and in the file. Mark ${one ? "it" : "them"} as matching, so a later change to ${one ? "it is" : "them is"} written back rather than seen as a conflict.`;
  if (plan.conflicts.length > 0) return "There is nothing to write back.";
  return "There is nothing to write back: the file already has these values.";
}

// The Code dialog's codebase section: connect a local folder, bring its components in,
// and write a component's edits back to its file after previewing them (PC11).
function buildCodebasePart({ codebase, codebaseError, boundNode, close, error, project }) {
  const section = el("section", { id: "codebase", "aria-labelledby": "codebase-title" }, el("h3", { id: "codebase-title" }, "Codebase"));
  // Links set aside as untrusted, or kept unread for now, are said, not dropped silently (#268).
  if (codebase?.problem) section.append(el("p", { class: "error", role: "status" }, `The saved codebase links could not be used: ${codebase.problem}`));
  const busy = (button, task) => async () => {
    error.textContent = "";
    button.disabled = true;
    try {
      await task();
    } catch (failure) {
      if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
    } finally {
      button.disabled = false;
    }
  };
  const connectForm = () => {
    const folder = el("input", { id: "codebase-folder", name: "folder", autocomplete: "off", spellcheck: "false", placeholder: "/home/you/my-app/src" });
    const connect = el("button", { type: "submit", class: "primary" }, "Connect folder");
    return el("form", {
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        busy(connect, async () => {
          const result = await state.client.post("/api/codebase/connect", { folder: folder.value.trim() }, { project });
          close();
          setStatus(`Connected ${result.folder}: ${result.components.length} component${result.components.length === 1 ? "" : "s"} found.`);
          openCodeDialog();
        })();
      },
    },
    el("label", { for: "codebase-folder" }, "A folder with your React components, in .js, .jsx or .tsx files (its full path)", folder),
    el("div", { class: "actions" }, connect));
  };
  if (codebaseError !== null) {
    section.append(el("p", {}, `The connected folder cannot be read: ${codebaseError}`));
    const disconnect = el("button", { type: "button" }, "Disconnect");
    disconnect.addEventListener("click", busy(disconnect, async () => {
      await state.client.post("/api/codebase/disconnect", {}, { project });
      close();
      openCodeDialog();
    }));
    section.append(el("div", { class: "actions" }, disconnect));
    return section;
  }
  if (codebase === null || codebase.folder === null) {
    section.append(el("p", {}, "Connect a folder of your code to bring its components into the design, and write your edits back to their files."), connectForm());
    return section;
  }
  const disconnect = el("button", { type: "button" }, "Disconnect");
  disconnect.addEventListener("click", busy(disconnect, async () => {
    await state.client.post("/api/codebase/disconnect", {}, { project });
    close();
    setStatus("The codebase is disconnected.");
  }));
  section.append(el("p", {}, "Connected: ", el("code", { id: "codebase-path" }, codebase.folder)), el("div", { class: "actions" }, disconnect));
  if (codebase.components.length === 0) section.append(el("p", {}, "No exported function components were found in its .js, .jsx and .tsx files."));
  else {
    section.append(el("ul", { class: "project-list", id: "codebase-components", "aria-label": "Components in the codebase" }, codebase.components.map(({ file, component }) => {
      const bring = el("button", { type: "button", "data-file": file, "data-component": component, "aria-label": `Bring in ${component} from ${file}` }, "Bring in");
      bring.addEventListener("click", () => {
        error.textContent = "";
        bring.disabled = true;
        enqueue(async () => {
          try {
            const result = await state.client.post("/api/codebase/import", { file, component }, { project });
            close();
            applyChange(result);
            selectLayers([result.frameId]);
            canvas.fit();
            renderToolbar();
            setStatus(`${result.intent}: ${result.layers} layers added.${styleLeftOutNote(result)}${styleOutOfOrderNote(result)}`);
          } catch (failure) {
            bring.disabled = false;
            if (failure instanceof HostError && failure.code === "project-needs-reopen") {
              close();
              handleEditError(failure);
            } else if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
          }
        });
      });
      return el("li", { class: "codebase-row" }, el("span", {}, el("strong", {}, component), ` ${file}`), bring);
    })));
  }
  if (codebase.truncated) section.append(el("p", {}, `Only the first ${codebase.files} source files were read.`));
  if (boundNode !== null) {
    const file = boundNode.props.codeSource.file;
    const preview = el("div", { id: "codebase-preview", "aria-live": "polite" });
    const review = el("button", { type: "button", id: "codebase-review" }, `Write changes back to ${file}`);
    // Fields changed both here and in the file that the person chose to keep as they are here,
    // each with the file's value it was kept against.
    const keep = new Map();
    // What each Take left out of a style: said once by the host, so kept while the dialog is open.
    const tookNotes = [];
    const tookNote = () => (tookNotes.length === 0 ? [] : [el("p", { class: "hint", id: "codebase-take-note" }, tookNotes.join(" "))]);
    const quoted = (value) => `“${value.length > 120 ? `${value.slice(0, 119)}…` : value}”`;
    const showPlan = async () => {
      error.textContent = "";
      const plan = await state.client.post("/api/codebase/preview", { nodeId: boundNode.id, keep: [...keep.values()] }, { project });
      const items = (entries, render) => (entries.length === 0 ? [] : [el("ul", {}, entries.map((entry) => el("li", {}, render(entry))))]);
      // A field changed in both places shows both values and lets the person pick one (#236).
      const conflictItem = (conflict) => {
        if (!conflict.overridable) return `${conflict.field}: ${conflict.reason}`;
        // While one choice is under way, Review and every button of the plan shown are
        // disabled, so nothing is queued against a plan about to change (#291). After a failure
        // those still shown come back.
        const buttons = [];
        const choose = (button, action) => button.addEventListener("click", () => {
          if (button.disabled) return;
          const held = [review, ...preview.querySelectorAll("button")].filter((each) => !each.disabled);
          for (const each of held) each.disabled = true;
          enqueue(async () => {
            try {
              await action();
              review.disabled = false;
            } catch (failure) {
              for (const each of held) if (each.isConnected) each.disabled = false;
              if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
            }
          });
        });
        const take = el("button", { type: "button", class: "take-file" }, "Take the file's");
        buttons.push(take);
        choose(take, async () => {
          const taken = await state.client.post("/api/codebase/resolve", { nodeId: conflict.nodeId, field: conflict.field, file: conflict.file }, { project });
          applyChange(taken);
          const notes = `${styleLeftOutNote(taken)}${styleOutOfOrderNote(taken)}`;
          if (notes !== "") tookNotes.push(`Took the file's ${conflict.field}.${notes}`);
          try {
            await showPlan();
          } catch (failure) {
            // Taken: the plan shown is out of date, and is not left up to be acted on.
            preview.replaceChildren(el("p", {}, `Took the file's ${conflict.field}. Review the write-back again to see what is left.`), ...tookNote());
            throw failure;
          }
        });
        // A value Ninerr cannot write is not offered to keep.
        const mine = conflict.keepable ? el("button", { type: "button", class: "keep-here" }, "Keep Ninerr's") : null;
        if (mine !== null) {
          buttons.push(mine);
          choose(mine, async () => {
            const key = `${conflict.nodeId}:${conflict.field}`;
            keep.set(key, { nodeId: conflict.nodeId, field: conflict.field, file: conflict.file });
            try {
              await showPlan();
            } catch (failure) {
              // Not reviewed with it kept: it is not kept.
              keep.delete(key);
              throw failure;
            }
          });
        }
        return [
          el("span", {}, `${conflict.field}: here ${quoted(conflict.here)}, in the file ${quoted(conflict.file)} (both changed from ${quoted(conflict.base)})${conflict.keepable ? "" : ` — ${conflict.reason.split("; ").slice(1).join("; ")}`}`),
          el("span", { class: "actions" }, take, mine),
        ];
      };
      preview.replaceChildren(
        ...tookNote(),
        el("p", {}, planSummary(plan)),
        ...(plan.diff === "" ? [] : [el("pre", { class: "diff", id: "codebase-diff", tabindex: "0", "aria-label": `Changes to ${plan.file}` }, plan.diff)]),
        ...(plan.conflicts.length === 0 ? [] : [el("p", {}, "Changed both here and in the file, so not written:")]),
        ...items(plan.conflicts, conflictItem),
        ...(plan.notWritten.length === 0 ? [] : [el("p", {}, "Not written back:")]),
        ...items(plan.notWritten, (entry) => entry.reason),
      );
      if (plan.changes.length > 0 || plan.matched.length > 0) {
        const write = el("button", { type: "button", class: "primary", id: "codebase-write" }, plan.changes.length > 0 ? "Write to file" : "Mark as matching");
        write.addEventListener("click", () => {
          error.textContent = "";
          write.disabled = true;
          enqueue(async () => {
            try {
              const result = await state.client.post("/api/codebase/write", { nodeId: boundNode.id, token: plan.token, keep: [...keep.values()] }, { project });
              close();
              applyChange(result);
              setStatus(result.written > 0 ? `Wrote ${result.written} change${result.written === 1 ? "" : "s"} to ${result.file}.` : `Marked ${result.matched} field${result.matched === 1 ? "" : "s"} as matching ${result.file}.`);
            } catch (failure) {
              write.disabled = false;
              if (failure instanceof HostError && failure.code === "project-needs-reopen") {
                close();
                handleEditError(failure);
              } else if (!handleSessionEnded(failure)) error.textContent = describeError(failure);
            }
          });
        });
        preview.append(el("div", { class: "actions" }, write));
      }
    };
    review.addEventListener("click", busy(review, showPlan));
    section.append(el("div", { class: "actions" }, review), preview);
  }
  return section;
}

// ---------- loading and applying changes ----------

async function loadProject() {
  const session = await state.client.get("/api/session");
  state.user = session.user ?? state.user;
  if (session.project === null) {
    clearProject();
    return session;
  }
  state.project = session.project;
  if (session.failure) {
    renderChrome();
    showReopen(session.failure);
    return session;
  }
  await requestResync();
  showRecovery(session.recovery);
  return session;
}

// One load at a time. A request made while one is in flight (the project switched again)
// runs another load once it settles, so the last request always wins.
let loading = null;
let loadAgain = false;
function requestLoad() {
  if (loading !== null) {
    loadAgain = true;
    return loading;
  }
  loading = (async () => {
    let session;
    do {
      loadAgain = false;
      session = await loadProject();
    } while (loadAgain);
    return session;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

// Retries after a failed refresh back off, from 250 ms to 30 s, and reset on success.
let retryDelay = 250;
function retryLoad() {
  if (state.client === null || ended) return;
  const delay = retryDelay;
  retryDelay = Math.min(30_000, retryDelay * 2);
  setTimeout(() => requestLoad().catch((error) => {
    if (!handleSessionEnded(error)) retryLoad();
  }), delay);
}

function clearProject() {
  state.project = null;
  state.document = null;
  state.revision = 0;
  state.selection = [];
  state.history = [];
  state.seen.clear();
  canvas.setDocument({ schemaVersion: 1, id: "none", name: "", revision: 0, rootIds: [], nodes: {}, metadata: {} });
  renderAll();
}

/**
 * Fetch the document and history again: the copy is replaced, never merged. Change events
 * that arrive meanwhile are held, and replayed on top of the fetched copy afterwards (those
 * at or below its revision are already in it), so none is lost or applied twice.
 */
// Timings, as standard User Timing measures (performance.getEntriesByName): the first
// render of an open project (from requesting its document from the host, which already has
// it open, through fetch and parse to the drawn canvas), each change applied from the
// event stream (from the event's arrival), and each edit made here (from the request).
// Each ends when the editor's DOM is updated, before the browser paints. Each kept to at
// most 1,000 at a time (the oldest batch is cleared).
function measure(name, start) {
  try {
    performance.measure(name, { start, end: performance.now() });
    if (performance.getEntriesByName(name, "measure").length > 1000) performance.clearMeasures(name);
  } catch {
    // Timing is never allowed to affect editing.
  }
}

async function resync() {
  const started = performance.now();
  const [{ project, revision, document: next }, { entries }, session] = await Promise.all([
    state.client.get("/api/document"),
    state.client.get("/api/history"),
    state.client.get("/api/session"),
  ]);
  if (session.project !== state.project || project !== state.project) throw new ProjectChanged();
  state.revision = revision;
  state.document = next;
  state.history = entries.filter((entry) => entry.revision <= revision).slice(-MAX_HISTORY_SHOWN);
  state.seen = new Set(state.history.map((entry) => entry.transactionId));
  state.canUndo = Boolean(session.canUndo);
  state.canRedo = Boolean(session.canRedo);
  state.revertible = Array.isArray(session.revertible) ? session.revertible : [];
  canvas.setDocument(next);
  // A layer inserted here whose change the refresh brought in is selected now.
  takePendingSelection();
  state.selection = canvas.selection;
  measure("ninerr:render-project", started);
}

class ProjectChanged extends Error {}

let resyncing = null;
let applying = false;
let held = [];
function requestResync() {
  resyncing ??= (async () => {
    let failed = false;
    try {
      await resync();
    } catch (error) {
      failed = true;
      canvas.clearPreview();
      if (!handleSessionEnded(error)) setStatus(error instanceof ProjectChanged ? "The project changed; refreshing again." : describeError(error));
    } finally {
      resyncing = null;
    }
    const replay = held.sort((a, b) => a.revision - b.revision);
    held = [];
    if (failed) {
      // The project changed under the refresh (or the host is unreachable): start over.
      retryLoad();
      return;
    }
    retryDelay = 250;
    for (const event of replay) applyChange(event);
    renderAll();
  })();
  return resyncing;
}

/** Apply one committed change event to the local copy, in revision order. */
/**
 * Select the layers the latest insert added, once they are all in the copy; true if it did.
 * Called while a change is applied or after a refresh, never later: a selection the person
 * made since is theirs.
 */
function takePendingSelection() {
  const pending = state.selectOnApply;
  if (pending === null || !pending.ids.every((id) => Object.hasOwn(state.document.nodes, id))) return false;
  canvas.select(pending.ids);
  pending.applied = true;
  state.selectOnApply = null;
  return true;
}

function applyChange(event) {
  if (event.project !== undefined && event.project !== state.project) return; // another project's
  if (resyncing !== null) {
    held.push(event);
    return;
  }
  if (state.document === null || event.revision <= state.revision) return; // already applied
  if (event.revision !== state.revision + 1) {
    requestResync();
    return;
  }
  let result;
  let rootTouched = false;
  try {
    // The host validated and committed the change; the editor's copy follows it in place.
    // If it does not apply, the copy is out of date and is fetched again.
    // Whether top-level layers change, read before applying (the tree still shows the old).
    rootTouched = event.operations.some((operation) => ((operation.type === "insert-node" || operation.type === "restore-subtree" || operation.type === "move-node") && (operation.parentId ?? null) === null)
      || (typeof operation.nodeId === "string" && document.getElementById(`layer-${operation.nodeId}`)?.parentElement === $("layers")));
    result = applyCommittedTransaction(state.document, { operations: event.operations });
  } catch {
    requestResync();
    return;
  }
  state.document = result.document;
  state.revision = event.revision;
  // The Tokens dialog shows the document as it now is, whoever changed it.
  if (redrawTokens !== null && redrawTokens() === false) redrawTokens = null;
  if (redrawComponents !== null && redrawComponents() === false) redrawComponents = null;
  if (!state.seen.has(event.transactionId)) {
    state.seen.add(event.transactionId);
    const { operations: _operations, ...summary } = event;
    state.history.push(summary);
    if (state.history.length > MAX_HISTORY_SHOWN) state.history.shift();
  }
  const selectionBefore = [...state.selection];
  let selectedNew = false;
  applying = true;
  try {
    canvas.update(state.document, result.affectedNodeIds);
    // A layer added here is selected with the change that adds it, whether the change event
    // or the edit's own answer arrives first (#274): a command made just after it then acts on
    // what the canvas shows, not on the selection before.
    selectedNew = takePendingSelection();
  } finally {
    applying = false;
  }
  state.selection = canvas.selection;
  if (selectedNew && state.selection.length > 0) state.focusedLayer = state.selection.at(-1);
  // A change that removed selected layers changes the selection; agents see it too.
  if (state.selection.length !== selectionBefore.length || state.selection.some((id, index) => id !== selectionBefore[index])) shareSelection();
  // This user's changes move this user's undo and redo stacks; an agent's change may become
  // the one this user can undo with "Undo agent change", and is announced when it does.
  refreshUndoState(event.actor !== state.user.actorId && event.actorKind === "agent" ? event : null);
  renderToolbar();
  try {
    patchLayers(result.affectedNodeIds, rootTouched, selectionBefore);
  } catch {
    renderLayers();
  }
  // The new layer's row becomes the tree's one tab stop, as selecting it there would make it.
  if (selectedNew && state.focusedLayer !== null) rovingTo(state.focusedLayer);
  renderInspector();
  renderHistory();
}

let undoStateAsked = 0;

async function refreshUndoState(agentEvent = null) {
  // Asked after every change: an older answer that arrives after a newer one is dropped.
  const asked = ++undoStateAsked;
  try {
    const session = await state.client.get("/api/session");
    if (asked !== undoStateAsked) return;
    state.canUndo = Boolean(session.canUndo);
    state.canRedo = Boolean(session.canRedo);
    state.revertible = Array.isArray(session.revertible) ? session.revertible : [];
    renderToolbar();
    renderHistory();
    if (agentEvent !== null && state.revertible.includes(agentEvent.transactionId)) {
      setStatus(`${actorLabel(agentEvent)}: ${agentEvent.intent ?? "a change"}. Undo agent change undoes it.`);
    }
  } catch {
    // The next change refreshes it.
  }
}

/** Run host calls one at a time, so each edit's base revision is the latest applied one. */
function enqueue(task) {
  const run = state.queue.then(task, task);
  state.queue = run.catch(() => {});
  return run;
}

/** A 401 means this page's session is over (Ninerr restarted); say so once. */
let ended = false;
function handleSessionEnded(error) {
  if (!(error instanceof HostError) || error.status !== 401) return false;
  if (!ended) {
    ended = true;
    forgetToken(window);
    state.events?.close();
    showDialog("This Ninerr session has ended", () => [el("p", {}, "Ninerr was restarted or the link expired. Open Ninerr again from its launcher.")], { dismissable: false });
  }
  return true;
}

function handleEditError(error) {
  if (handleSessionEnded(error)) return;
  if (error instanceof HostError) {
    if (error.code === "project-needs-reopen") {
      showReopen(error.message);
      return;
    }
    if (error.code === "stale-revision") {
      setStatus("The project changed before your edit arrived, so it was not applied. Try it again.");
      requestResync();
      return;
    }
    if (error.code === "undo-conflict" || error.code === "redo-conflict") {
      // A stylesheet that may not come back (unsafe, or past the project's budget) says why.
      const sheet = /no longer be applied: ((?:a stylesheet|a project's stylesheets)[^]*)$/u.exec(error.message ?? "");
      setStatus(sheet ? `This cannot be undone or redone now: ${sheet[1]}.` : "A later change touches the same layers, so this cannot be undone or redone now.");
      return;
    }
  }
  setStatus(describeError(error));
  requestResync();
}

/**
 * Commit `operations` (computed from the document at `computedAt`) as one transaction. An
 * edit computed from a copy that has since moved on is dropped rather than sent.
 */
function commit(operations, intent, computedAt = state.document?.revision) {
  if (operations.length === 0) return Promise.resolve(null);
  return enqueue(async () => {
    if (state.document === null || computedAt !== state.document.revision) {
      canvas.clearPreview();
      setStatus("That change was skipped: it was made before the previous change had finished. Try it again.");
      return null;
    }
    try {
      const started = performance.now();
      const event = await state.client.post("/api/edit", { baseRevision: state.revision, operations, intent });
      applyChange(event);
      // Only when this edit's change was applied here (not held for a refresh).
      if (state.revision === event.revision) measure("ninerr:edit", started);
      setStatus(intent ? `${intent}.` : "Changed.");
      return event;
    } catch (error) {
      canvas.clearPreview();
      handleEditError(error);
      return null;
    }
  });
}

function undoRedo(kind) {
  return enqueue(async () => {
    if (state.document === null) return;
    try {
      const event = await state.client.post(`/api/${kind}`);
      applyChange(event);
      setStatus(event.intent ? `${event.intent}.` : kind === "undo" ? "Undone." : "Redone.");
    } catch (error) {
      if (error instanceof HostError && (error.code === "nothing-to-undo" || error.code === "nothing-to-redo")) {
        setStatus(kind === "undo" ? "Nothing to undo." : "Nothing to redo.");
        refreshUndoState();
      } else {
        handleEditError(error);
      }
    }
  });
}

/** The latest agent change this person may revert now, from the history; null when none is. */
function latestAgentChange() {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const entry = state.history[index];
    if (entry.actorKind === "agent" && state.revertible.includes(entry.transactionId)) return entry;
  }
  return null;
}

/** Undo the latest agent change, chosen when the edits queued before it have applied. */
function undoAgentChange() {
  return enqueue(async () => {
    const entry = latestAgentChange();
    if (entry === null) {
      setStatus("No agent change to undo.");
      return;
    }
    await revertNow(entry, "That agent change was already undone or replaced.");
  });
}

function revert(entry) {
  return enqueue(() => revertNow(entry, "Only an agent's latest change can be reverted. Revert its later changes first."));
}

async function revertNow(entry, notRevertible) {
  if (state.document === null) return;
  try {
    const event = await state.client.post("/api/revert", { transactionId: entry.transactionId });
    applyChange(event);
    setStatus(`${event.intent}.`);
  } catch (error) {
    if (error instanceof HostError && (error.code === "not-revertible" || error.code === "revert-conflict")) {
      setStatus(error.code === "not-revertible" ? notRevertible : "A later change touches the same layers, so this cannot be reverted now.");
      // What may be reverted has changed since the editor last asked.
      refreshUndoState();
    } else {
      handleEditError(error);
    }
  }
}

function save() {
  return enqueue(async () => {
    if (state.document === null) return;
    try {
      const { revision } = await state.client.post("/api/checkpoint");
      setStatus(`Saved. Every change is kept in the project's history; this saved a snapshot at revision ${revision}.`);
    } catch (error) {
      handleEditError(error);
    }
  });
}

// The event stream reconnects with a growing delay (1 s to 30 s, reset once it opens), and
// refreshes the copy on reopening, since changes may have been missed while it was down.
let streamDelay = 1000;
// Settled once, when the first stream is open and the copy has caught up, or when it was
// refused (#302): the editor is ready from then on.
let settleStream = null;
const streamSettled = new Promise((resolve) => {
  settleStream = resolve;
});
/**
 * Start the change stream. The copy was loaded before the stream opened, so a change committed
 * in between would never arrive: the host's first message on a stream names the project and its
 * revision, and a copy behind it is refreshed then (#302).
 */
function listenForChanges({ refreshOnOpen = false } = {}) {
  state.events?.close();
  if (ended) return;
  const events = state.client.events();
  state.events = events;
  let dropped = refreshOnOpen;
  events.addEventListener("change", (message) => {
    const received = performance.now();
    try {
      const event = JSON.parse(message.data);
      const before = state.revision;
      applyChange(event);
      if (state.revision === event.revision && before === event.revision - 1) measure("ninerr:apply-change", received);
    } catch {
      requestResync();
    }
  });
  events.addEventListener("confirmations", (message) => {
    try {
      showConfirmations(JSON.parse(message.data).pending ?? []);
    } catch {
      // ignore a malformed event
    }
  });
  events.addEventListener("project", (message) => {
    let info;
    try {
      info = JSON.parse(message.data);
    } catch {
      return;
    }
    let caughtUp = Promise.resolve();
    if (info.failure && info.project === state.project) showReopen(info.failure);
    else if (info.project !== state.project) {
      // The copy belongs to the old project: stop applying to it until the new one is loaded.
      state.project = info.project;
      state.document = null;
      renderAll();
      caughtUp = requestLoad().catch((error) => {
        if (!handleSessionEnded(error)) setStatus(describeError(error));
      });
    } else if (state.document !== null && Number.isInteger(info.revision) && info.revision > state.revision) {
      // Changes were committed before this stream subscribed: fetch them (#302).
      caughtUp = requestResync();
    } else if (loading !== null) caughtUp = loading.catch(() => undefined);
    // The first stream's first message: the editor is ready once its copy caught up.
    caughtUp.finally(() => settleStream());
  });
  events.addEventListener("error", () => {
    dropped = true;
    // A closed stream is not retried by the browser: find out whether the session ended,
    // and otherwise open a new one after a delay.
    if (events.readyState === 2 && state.events === events) {
      settleStream();
      const delay = streamDelay;
      streamDelay = Math.min(30_000, streamDelay * 2);
      state.client.get("/api/session").then(
        () => setTimeout(() => listenForChanges({ refreshOnOpen: true }), delay),
        (error) => {
          if (!handleSessionEnded(error)) setTimeout(() => listenForChanges({ refreshOnOpen: true }), delay);
        },
      );
    }
  });
  events.addEventListener("open", () => {
    streamDelay = 1000;
    // Changes may have been missed while the stream was down.
    if (dropped && state.document !== null) requestResync();
    dropped = false;
  });
}

// ---------- editing commands ----------

let counter = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function insert(kind) {
  if (state.document === null) return;
  const doc = state.document;
  const operations = [];
  let parentId = null;
  const selected = state.selection.length === 1 ? doc.nodes[state.selection[0]] : null;
  if (selected && selected.type !== "text") parentId = selected.id;
  // With nothing selected, a new layer goes on the page shown.
  else if (layerRoots(doc).length > 0) parentId = currentPage(doc);
  else {
    // An empty project gets a page to hold its first layer.
    const pageId = newId("page");
    operations.push(...insertNode(null, 0, { id: pageId, type: "frame", tag: "main", style: { ...PAGE_STYLE } }));
    parentId = pageId;
  }
  const index = parentId === null ? doc.rootIds.length : (doc.nodes[parentId]?.children.length ?? 0);
  const id = newId(kind === "text" ? "text" : "box");
  operations.push(...(kind === "text"
    ? insertNode(parentId, index, { id, type: "text", tag: "p", text: "Text", style: { position: "absolute", left: "32px", top: "32px", margin: "0px", "font-size": "16px" } })
    : insertNode(parentId, index, { id, type: "element", tag: "div", style: { position: "absolute", left: "32px", top: "32px", width: "160px", height: "100px", background: "#d9d2ff" } })));
  commitAndSelect(operations, kind === "text" ? "Insert text" : "Insert box", id);
}

// ---------- pages ----------

// A project's pages are its top-level frames, drawn one after another on the canvas.
const PAGE_STYLE = { position: "relative", width: "800px", height: "600px", background: "#ffffff" };
const pageName = (doc, id, index) => (typeof doc.nodes[id]?.props?.name === "string" && doc.nodes[id].props.name.trim() !== "" ? doc.nodes[id].props.name.trim() : `Page ${index + 1}`);

/** The page a layer is on: its top-level ancestor. */
function pageOf(doc, id) {
  let node = doc?.nodes[id];
  for (let steps = 0; node && node.parentId !== null && steps <= 1_100; steps += 1) node = doc.nodes[node.parentId];
  return node ? node.id : null;
}

/** Add a page after the others, named for its place, select it and show it. */
function addPage() {
  if (state.document === null) return;
  const doc = state.document;
  const id = newId("page");
  const pages = layerRoots(doc);
  // A name no other page has: Page 2, or Page 3 if Page 2 is taken.
  const taken = new Set(pages.map((pageId, index) => pageName(doc, pageId, index)));
  let number = pages.length + 1;
  while (taken.has(`Page ${number}`)) number += 1;
  const operations = insertNode(null, doc.rootIds.length, { id, type: "frame", tag: "main", style: { ...PAGE_STYLE } });
  operations[0].node.props.name = `Page ${number}`;
  state.showOnApply = id;
  state.shownPage = id;
  commitAndSelect(operations, "Add page", id);
}

/** The page shown: the selected layer's, else the one last shown, else the first. */
function currentPage(doc) {
  const pages = layerRoots(doc);
  const fromSelection = pageOf(doc, state.selection.at(-1) ?? state.focusedLayer);
  if (fromSelection !== null && pages.includes(fromSelection)) return fromSelection;
  if (state.shownPage !== null && pages.includes(state.shownPage)) return state.shownPage;
  return pages[0] ?? null;
}

/** Select a page and fit the canvas to it. */
function showPage(id) {
  if (state.document === null || !state.document.nodes[id]) return;
  state.shownPage = id;
  selectLayers([id]);
  canvas.showLayer(id);
  renderToolbar();
}

function renderPages() {
  const select = $("page-select");
  const doc = state.document;
  const pages = doc === null ? [] : layerRoots(doc);
  const current = doc === null ? null : currentPage(doc);
  // Redrawn only when what it shows changes, so an open list is not reset under the pointer.
  const names = pages.map((id, index) => pageName(doc, id, index));
  const key = JSON.stringify([pages, names, current]);
  if (select.dataset.key !== key) {
    select.replaceChildren(...pages.map((id, index) => el("option", { value: id, selected: id === current }, names[index])));
    select.dataset.key = key;
  }
  select.disabled = pages.length === 0;
  $("action-show-page").disabled = pages.length === 0;
  $("action-add-page").disabled = doc === null;
  // A page just added is shown once the canvas has drawn it.
  if (state.showOnApply !== null && doc !== null && Object.hasOwn(doc.nodes, state.showOnApply) && canvas.showLayer(state.showOnApply)) state.showOnApply = null;
}

/** Commit a change that adds layer `id`, and select it once the change is applied. */
function commitAndSelect(operations, intent, id) {
  const pending = { ids: [id], applied: false };
  state.selectOnApply = pending;
  return commit(operations, intent).then((event) => {
    // Selected when its change was applied, or later by the person: leave it.
    if (pending.applied) return event;
    // Skipped or refused: nothing to select.
    if (event === null) {
      if (state.selectOnApply === pending) state.selectOnApply = null;
      return event;
    }
    // Held for a refresh: the refresh selects it once the copy has it.
    if (state.revision < event.revision) return event;
    if (state.selectOnApply === pending) state.selectOnApply = null;
    selectLayers([id]);
    return event;
  });
}

function deleteSelection() {
  if (state.document === null || state.selection.length === 0) return;
  commit(removeNodes(state.document, state.selection), state.selection.length === 1 ? "Delete layer" : "Delete layers");
}

function selectLayers(ids) {
  canvas.select(ids);
  state.selection = canvas.selection;
  if (state.selection.length > 0) state.focusedLayer = state.selection.at(-1);
  renderLayers();
  renderInspector();
  renderToolbar();
}

// ---------- rendering ----------

function layerLabel(node) {
  const name = typeof node.props?.name === "string" && node.props.name.trim() !== "" ? node.props.name : null;
  if (name) return name;
  const text = typeof node.props?.text === "string" && node.props.text.trim() !== "" ? ` “${node.props.text.trim().slice(0, 24)}”` : "";
  const tag = typeof node.props?.tag === "string" ? node.props.tag : node.type;
  return `${tag}${text}`;
}

/** The visible layers in tree order: [{ id, level, parentId, hasChildren }]. */
function visibleLayers() {
  const out = [];
  const doc = state.document;
  if (doc === null) return out;
  const walk = (ids, level, parentId) => {
    for (const id of ids) {
      const node = doc.nodes[id];
      if (!node) continue;
      out.push({ id, level, parentId, hasChildren: node.children.length > 0 });
      if (node.children.length > 0 && !state.collapsed.has(id)) walk(node.children, level + 1, id);
    }
  };
  walk(layerRoots(doc), 1, null);
  return out;
}

// One layer's tree item (and, when expanded, its children's).
function buildLayerItem(id, level, selected = new Set(state.selection)) {
  const doc = state.document;
  const node = doc.nodes[id];
  const expanded = node.children.length > 0 ? !state.collapsed.has(id) : null;
  const item = el("li", {
    role: "treeitem",
    id: `layer-${id}`,
    "data-node-id": id,
    "aria-level": level,
    "aria-selected": selected.has(id) ? "true" : "false",
    "aria-expanded": expanded === null ? null : String(expanded),
    tabindex: id === state.focusedLayer ? "0" : "-1",
  }, el("span", { class: "row", draggable: "true", style: `padding-left:${6 + (level - 1) * 14}px` },
    el("span", { class: "twisty", "aria-hidden": "true" }, expanded === null ? "" : expanded ? "▾" : "▸"),
    el("span", { class: "label" }, layerLabel(node))));
  if (expanded) item.append(el("ul", { role: "group", class: "children" }, node.children.filter((child) => doc.nodes[child]).map((child) => buildLayerItem(child, level + 1, selected))));
  return item;
}

function renderLayers() {
  const tree = $("layers");
  const hadFocus = tree.contains(document.activeElement);
  const doc = state.document;
  const visible = visibleLayers();
  $("layers-empty").hidden = doc === null || layerRoots(doc).length > 0;
  if (doc === null) {
    tree.replaceChildren();
    return;
  }
  if (!visible.some((layer) => layer.id === state.focusedLayer)) state.focusedLayer = state.selection.find((id) => visible.some((layer) => layer.id === id)) ?? visible[0]?.id ?? null;
  const selected = new Set(state.selection);
  tree.replaceChildren(...layerRoots(doc).map((id) => buildLayerItem(id, 1, selected)));
  if (hadFocus && state.focusedLayer !== null) $(`layer-${state.focusedLayer}`)?.focus();
}

/** Make `container`'s items match `childIds`, reusing items already there. */
function reconcileLayerList(container, childIds, level) {
  const wanted = new Set(childIds);
  let cursor = container.firstElementChild;
  for (const id of childIds) {
    while (cursor && !wanted.has(cursor.dataset.nodeId)) {
      const stale = cursor;
      cursor = cursor.nextElementSibling;
      stale.remove();
    }
    let item = document.getElementById(`layer-${id}`);
    // An item moved to another depth is rebuilt, for its level and indentation.
    if (!item || item.getAttribute("aria-level") !== String(level)) {
      item?.remove();
      item = buildLayerItem(id, level);
    }
    if (item === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(item, cursor);
  }
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    stale.remove();
  }
}

/**
 * Update the layers tree for one applied change, touching only the rows and lists the
 * change affects: on a 10,000-layer project, redrawing the whole tree costs far more than
 * the change. `rootTouched` says whether top-level layers changed.
 */
function patchLayers(affectedNodeIds, rootTouched, previousSelection) {
  const doc = state.document;
  const tree = $("layers");
  const hadFocus = tree.contains(document.activeElement);
  for (const id of affectedNodeIds) {
    const node = doc.nodes[id];
    const item = document.getElementById(`layer-${id}`);
    if (!node) {
      item?.remove();
      continue;
    }
    if (!item) continue; // inside a collapsed layer, or new: placed by its parent's list
    const expanded = node.children.length > 0 ? !state.collapsed.has(id) : null;
    if (expanded === null) item.removeAttribute("aria-expanded");
    else item.setAttribute("aria-expanded", String(expanded));
    item.querySelector(":scope > .row .twisty").textContent = expanded === null ? "" : expanded ? "▾" : "▸";
    item.querySelector(":scope > .row .label").textContent = layerLabel(node);
    let group = item.querySelector(":scope > ul");
    if (!expanded) {
      group?.remove();
      continue;
    }
    if (!group) {
      group = el("ul", { role: "group", class: "children" });
      item.append(group);
    }
    reconcileLayerList(group, node.children.filter((child) => doc.nodes[child]), Number(item.getAttribute("aria-level")) + 1);
  }
  if (rootTouched) reconcileLayerList(tree, layerRoots(doc), 1);
  $("layers-empty").hidden = layerRoots(doc).length > 0;
  for (const id of new Set([...previousSelection, ...state.selection])) {
    document.getElementById(`layer-${id}`)?.setAttribute("aria-selected", state.selection.includes(id) ? "true" : "false");
  }
  if (state.focusedLayer === null || !document.getElementById(`layer-${state.focusedLayer}`)) {
    state.focusedLayer = state.selection.find((id) => document.getElementById(`layer-${id}`)) ?? tree.querySelector("[role=treeitem]")?.dataset.nodeId ?? null;
    if (state.focusedLayer !== null) document.getElementById(`layer-${state.focusedLayer}`).tabIndex = 0;
  }
  if (hadFocus && !tree.contains(document.activeElement) && state.focusedLayer !== null) document.getElementById(`layer-${state.focusedLayer}`)?.focus();
}

/** The layers tree's roving tab stop: `id`'s row is the one the Tab key reaches. */
function rovingTo(id) {
  state.focusedLayer = id;
  for (const item of $("layers").querySelectorAll("[role=treeitem]")) item.tabIndex = item.dataset.nodeId === id ? 0 : -1;
}

function focusLayer(id) {
  rovingTo(id);
  $(`layer-${id}`)?.focus();
}

function onLayersKey(event) {
  const visible = visibleLayers();
  const at = visible.findIndex((layer) => layer.id === state.focusedLayer);
  if (at < 0) return;
  const current = visible[at];
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.startsWith("Arrow")) {
    handled();
    moveByKey(current.id, event.key);
    return;
  }
  switch (event.key) {
    case "ArrowDown":
      handled();
      if (at + 1 < visible.length) focusLayer(visible[at + 1].id);
      break;
    case "ArrowUp":
      handled();
      if (at > 0) focusLayer(visible[at - 1].id);
      break;
    case "Home":
      handled();
      focusLayer(visible[0].id);
      break;
    case "End":
      handled();
      focusLayer(visible.at(-1).id);
      break;
    case "ArrowRight":
      handled();
      if (current.hasChildren && state.collapsed.has(current.id)) {
        state.collapsed.delete(current.id);
        renderLayers();
      } else if (current.hasChildren) focusLayer(visible[at + 1].id);
      break;
    case "ArrowLeft":
      handled();
      if (current.hasChildren && !state.collapsed.has(current.id)) {
        state.collapsed.add(current.id);
        renderLayers();
      } else if (current.parentId !== null) focusLayer(current.parentId);
      break;
    case "Enter":
    case " ": {
      handled();
      const extend = event.shiftKey || event.ctrlKey || event.metaKey;
      const ids = extend
        ? (state.selection.includes(current.id) ? state.selection.filter((id) => id !== current.id) : [...state.selection, current.id])
        : [current.id];
      selectLayers(ids);
      focusLayer(current.id);
      break;
    }
    case "Delete":
    case "Backspace":
      handled();
      deleteSelection();
      break;
    default:
  }
}

// ---------- moving and grouping layers (P09) ----------

/** Where `id` sits: its parent (null for a page) and its index among its siblings. */
function placeOf(doc, id) {
  const parentId = doc.nodes[id].parentId ?? null;
  const siblings = parentId === null ? doc.rootIds : doc.nodes[parentId].children;
  return { parentId, index: siblings.indexOf(id), siblings };
}

/**
 * Why moving `id` under `parentId` is refused, or null. Pages stay at the top and layers
 * stay on pages; nothing goes inside a text layer or inside itself.
 */
// Elements that hold no content of their own.
const LEAF_TAGS = new Set(["img", "input", "br", "hr", "area", "base", "col", "embed", "link", "meta", "source", "track", "wbr", "textarea", "select"]);

function holdsLayers(node) {
  return !["text", "image", "vector"].includes(node.type) && !LEAF_TAGS.has(node.props?.tag);
}

function moveProblem(doc, id, parentId) {
  const isPage = (doc.nodes[id].parentId ?? null) === null;
  if (isPage && parentId !== null) return "A page stays at the top level.";
  if (!isPage && parentId === null) return "A layer stays on a page.";
  if (parentId === null) return null;
  if (!holdsLayers(doc.nodes[parentId])) return "That layer holds no other layers.";
  for (let cursor = parentId; cursor !== null && cursor !== undefined; cursor = doc.nodes[cursor]?.parentId ?? null) {
    if (cursor === id) return "A layer cannot go inside itself.";
  }
  return null;
}

/** Move `id` to `index` under `parentId` (counted after it leaves its place), as one change. */
function moveLayer(id, parentId, index, intent) {
  const doc = state.document;
  const problem = moveProblem(doc, id, parentId);
  if (problem !== null) {
    setStatus(problem);
    return Promise.resolve(null);
  }
  const from = placeOf(doc, id);
  if (from.parentId === parentId && from.index === index) return Promise.resolve(null);
  // Into a collapsed layer: it opens, so the moved layer, and the focus, stay in view.
  let opened = false;
  for (let cursor = parentId; cursor !== null && cursor !== undefined; cursor = doc.nodes[cursor]?.parentId ?? null) opened = state.collapsed.delete(cursor) || opened;
  if (opened) renderLayers();
  return commit([{ type: "move-node", nodeId: id, parentId, index }], intent).then((event) => {
    if (event !== null) focusLayer(id);
    return event;
  });
}

function moveByKey(id, key) {
  const doc = state.document;
  if (doc === null) return;
  const { parentId, index, siblings } = placeOf(doc, id);
  if (key === "ArrowUp") {
    if (index === 0) setStatus("This layer is already first among its siblings.");
    else moveLayer(id, parentId, index - 1, "Move layer up");
  } else if (key === "ArrowDown") {
    if (index === siblings.length - 1) setStatus("This layer is already last among its siblings.");
    else moveLayer(id, parentId, index + 1, "Move layer down");
  } else if (key === "ArrowRight") {
    // Into the layer above it, as its last child.
    if (index === 0) setStatus("There is no layer above this one to move it into.");
    else {
      const into = siblings[index - 1];
      moveLayer(id, into, doc.nodes[into].children.length, "Move layer into the layer above");
    }
  } else if (key === "ArrowLeft") {
    // Out of its parent, just after it.
    if (parentId === null) setStatus("A page stays at the top level.");
    else {
      const outer = placeOf(doc, parentId);
      moveLayer(id, outer.parentId, outer.index + 1, "Move layer out of its parent");
    }
  }
}

/** Group the selected layers (or the focused one) in a new layer where the first of them was. */
function groupSelection() {
  const doc = state.document;
  if (doc === null) return Promise.resolve(null);
  const chosen = new Set(state.selection.length > 0 ? state.selection : state.focusedLayer === null ? [] : [state.focusedLayer]);
  // A selected layer inside another selected one moves with it; in the tree's order.
  const order = [];
  const walk = (ids) => {
    for (const id of ids) {
      if (!doc.nodes[id]) continue;
      if (chosen.has(id)) order.push(id);
      else walk(doc.nodes[id].children);
    }
  };
  walk(layerRoots(doc));
  if (order.length === 0) {
    setStatus("Select the layers to group.");
    return Promise.resolve(null);
  }
  const { parentId, index } = placeOf(doc, order[0]);
  if (parentId === null || order.some((id) => (doc.nodes[id].parentId ?? null) === null)) {
    setStatus("Pages are not grouped; select layers on a page.");
    return Promise.resolve(null);
  }
  const groupId = newId("group");
  const operations = [];
  // Layers placed in pixels keep their place: the group is drawn around them, where the last
  // of them was (so it covers no layer it does not hold), and they are placed within it.
  const boxes = order.map((id) => pixelBox(doc.nodes[id]));
  if (boxes.every((box) => box !== null)) {
    if (order.some((id) => doc.nodes[id].parentId !== parentId)) {
      setStatus("Layers placed in pixels are grouped with layers of the same parent.");
      return Promise.resolve(null);
    }
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    const last = placeOf(doc, order.at(-1)).index;
    // Just after the last of them: it takes that place as they move into it.
    operations.push(...insertNode(parentId, last + 1, { id: groupId, type: "group", style: { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` } }));
    order.forEach((id, at) => {
      operations.push({ type: "move-node", nodeId: id, parentId: groupId, index: at });
      operations.push(...setStyle(doc, id, { left: `${boxes[at].left - left}px`, top: `${boxes[at].top - top}px` }));
    });
  } else {
    // Layers in the page's flow: the group takes the first one's place, and they flow in it.
    operations.push(...insertNode(parentId, index, { id: groupId, type: "group" }));
    order.forEach((id, at) => operations.push({ type: "move-node", nodeId: id, parentId: groupId, index: at }));
  }
  return commitAndSelect(operations, order.length === 1 ? "Group layer" : "Group layers", groupId);
}

/** A layer's box when it is placed in pixels (position absolute, px left, top, width, height); else null. */
function pixelBox(node) {
  const style = node.props?.style;
  if (!style || style.position !== "absolute") return null;
  const px = (value) => (typeof value === "string" && /^-?\d+(?:\.\d+)?px$/u.test(value) ? Number.parseFloat(value) : null);
  const box = { left: px(style.left), top: px(style.top), width: px(style.width), height: px(style.height) };
  return Object.values(box).every((value) => value !== null) ? box : null;
}

// Dragging a row: above its top quarter, before it; below its bottom quarter, after it;
// otherwise into it.
let draggedLayer = null;

function dropTarget(event) {
  const row = event.target.closest?.("[role=treeitem] > .row");
  if (!row || draggedLayer === null || state.document === null) return null;
  const targetId = row.parentElement.dataset.nodeId;
  const doc = state.document;
  if (!doc.nodes[targetId] || !doc.nodes[draggedLayer]) return null;
  const box = row.getBoundingClientRect();
  const y = (event.clientY - box.top) / box.height;
  let zone = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
  // Below an open layer's row is its first child's place, where the mark is drawn.
  const open = doc.nodes[targetId].children.length > 0 && !state.collapsed.has(targetId);
  let parentId;
  let index;
  if (zone === "after" && open) {
    parentId = targetId;
    index = 0;
  } else if (zone === "inside") {
    parentId = targetId;
    index = doc.nodes[targetId].children.filter((child) => child !== draggedLayer).length;
  } else {
    const target = placeOf(doc, targetId);
    parentId = target.parentId;
    index = target.index + (zone === "after" ? 1 : 0);
    // Counted after the dragged layer leaves its place.
    const from = placeOf(doc, draggedLayer);
    if (from.parentId === parentId && from.index < index) index -= 1;
  }
  if (targetId === draggedLayer || moveProblem(doc, draggedLayer, parentId) !== null) return null;
  return { row, zone, parentId, index };
}

function clearDropMarks() {
  for (const row of $("layers").querySelectorAll(".drop-before, .drop-after, .drop-inside")) row.classList.remove("drop-before", "drop-after", "drop-inside");
}

function onLayersDragStart(event) {
  const item = event.target.closest?.("[role=treeitem]");
  if (!item || state.document === null) return;
  draggedLayer = item.dataset.nodeId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedLayer);
}

function onLayersDragOver(event) {
  const target = dropTarget(event);
  clearDropMarks();
  if (target === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  target.row.classList.add(`drop-${target.zone}`);
}

function onLayersDrop(event) {
  const target = dropTarget(event);
  clearDropMarks();
  const id = draggedLayer;
  draggedLayer = null;
  if (target === null || id === null) return;
  event.preventDefault();
  moveLayer(id, target.parentId, target.index, target.zone === "inside" ? "Move layer into another" : "Move layer");
}

function onLayersDragEnd() {
  draggedLayer = null;
  clearDropMarks();
}

function onLayersClick(event) {
  const item = event.target.closest("[role=treeitem]");
  if (!item) return;
  const id = item.dataset.nodeId;
  const extend = event.shiftKey || event.ctrlKey || event.metaKey;
  selectLayers(extend ? (state.selection.includes(id) ? state.selection.filter((other) => other !== id) : [...state.selection, id]) : [id]);
  focusLayer(id);
}

// Lining several layers up, or spacing three or more evenly: the buttons do what Alt+A, D, W,
// S, H, V and Alt+Shift+H, V do on the canvas.
function alignGroup() {
  // Counted as align counts them: drawn, with a box, and none inside another selected one.
  const count = canvas?.alignable ?? 0;
  if (count < 2) return null;
  const align = (key, label, keys, action) => el("button", { type: "button", "data-align": key, "aria-keyshortcuts": keys, onclick: () => {
    // The change's own status says what it did. The inspector is drawn again when it arrives:
    // focus stays on this button.
    action();
    state.focusAlign = key;
  } }, label);
  return el("div", { class: "steps", role: "group", id: "align-group", "aria-label": `Align ${count} layers` },
    align("left", "Align left", "Alt+A", () => canvas.align("left")),
    align("center", "Align centre", "Alt+H", () => canvas.align("center")),
    align("right", "Align right", "Alt+D", () => canvas.align("right")),
    align("top", "Align top", "Alt+W", () => canvas.align("top")),
    align("middle", "Align middle", "Alt+V", () => canvas.align("middle")),
    align("bottom", "Align bottom", "Alt+S", () => canvas.align("bottom")),
    ...(count >= 3 ? [
      align("horizontal", "Space evenly across", "Alt+Shift+H", () => canvas.distribute("horizontal")),
      align("vertical", "Space evenly down", "Alt+Shift+V", () => canvas.distribute("vertical")),
    ] : []));
}

function renderInspector() {
  const form = $("inspector");
  const doc = state.document;
  // Keep what someone is typing when a change from elsewhere redraws the inspector.
  const active = form.contains(document.activeElement) ? document.activeElement : null;
  const typing = active && active.dataset.original !== undefined && active.value !== active.dataset.original
    ? { field: active.name, value: active.value, node: form.dataset.nodeId, start: active.selectionStart, end: active.selectionEnd }
    : null;
  const activeField = active?.name ?? null;
  if (doc === null || state.selection.length !== 1 || !doc.nodes[state.selection[0]]) {
    delete form.dataset.nodeId;
    form.replaceChildren(el("p", {}, doc === null ? "Open a project to start." : state.selection.length > 1 ? `${state.selection.length} layers selected.` : "Select a layer to edit it."), ...(doc !== null && state.selection.length > 1 ? [alignGroup()].filter(Boolean) : []));
    if (state.focusAlign) {
      form.querySelector(`[data-align="${state.focusAlign}"]`)?.focus();
      state.focusAlign = null;
    }
    return;
  }
  const node = doc.nodes[state.selection[0]];
  form.dataset.nodeId = node.id;
  const style = node.props?.style && typeof node.props.style === "object" ? node.props.style : {};
  const field = (name, label, value, multiline = false) => {
    const id = `inspect-${name.replace(":", "-")}`;
    const input = multiline
      ? el("textarea", { id, name, rows: 3 })
      : el("input", { id, name, type: "text", autocomplete: "off", spellcheck: "false" });
    input.value = value ?? "";
    input.dataset.original = input.value;
    return el("label", { for: id }, label, input);
  };
  const children = [field("name", "Layer name", typeof node.props?.name === "string" ? node.props.name : "")];
  // The element's classes, which its page's stylesheet styles it by (P09).
  const classes = node.props?.attributes?.class;
  const classesField = field("classes", "Classes, separated by spaces", typeof classes === "string" ? classes : "");
  // The longest attribute value the canvas draws.
  classesField.querySelector("input").maxLength = 2000;
  children.push(classesField);
  // An element's own words, wherever they are held (#235).
  const textId = textLayerOf(doc, node.id);
  // A {…} part of imported code is code, not words: it has no Text field (#370).
  if (textId !== null && !isCodePart(doc.nodes[textId])) children.push(field("text", "Text", typeof doc.nodes[textId].props?.text === "string" ? doc.nodes[textId].props.text : "", true));
  else if (isCodePart(node) || node.children.some((id) => isCodePart(doc.nodes[id]))) {
    // Beside other content, an element's words are on layers of their own, which can be edited.
    const onlyCode = isCodePart(node) || node.children.every((id) => isCodePart(doc.nodes[id]));
    children.push(el("p", { class: "hint", id: "inspect-code-note" }, onlyCode ? "This layer shows code from its source, so its text is changed in the code." : "This layer holds code from its source, which is changed in the code. What is beside it is edited on its own layers."));
  }
  const styleFields = STYLE_FIELDS.map(([name, label]) => field(`style:${name}`, label, typeof style[name] === "string" ? style[name] : ""));
  children.push(el("div", { class: "pair" }, styleFields.slice(0, 2)), el("div", { class: "pair" }, styleFields.slice(2, 4)), ...styleFields.slice(4));
  // How its words look: the font, its weight, line height, letter spacing and alignment.
  if (node.type === "text" || textId !== null) children.push(textSection(doc, style));
  // Moving and resizing without dragging (WCAG 2.5.7): one click per 10-pixel step.
  const step = (label, text, action) => el("button", { type: "button", "aria-label": label, onclick: action }, text);
  children.push(el("div", { class: "steps", role: "group", "aria-label": "Move and resize by 10 pixels" },
    step("Move left 10 pixels", "←", () => canvas.nudge(-10, 0)),
    step("Move right 10 pixels", "→", () => canvas.nudge(10, 0)),
    step("Move up 10 pixels", "↑", () => canvas.nudge(0, -10)),
    step("Move down 10 pixels", "↓", () => canvas.nudge(0, 10)),
    // Visible words are the accessible names (WCAG 2.5.3); the group says "by 10 pixels".
    el("button", { type: "button", onclick: () => canvas.resizeBy(-10, 0) }, "Narrower"),
    el("button", { type: "button", onclick: () => canvas.resizeBy(10, 0) }, "Wider"),
    el("button", { type: "button", onclick: () => canvas.resizeBy(0, -10) }, "Shorter"),
    el("button", { type: "button", onclick: () => canvas.resizeBy(0, 10) }, "Taller")));
  // In a field Ctrl+Z is the field's own, as in any text field (#378).
  children.push(el("p", { class: "hint", id: "inspect-undo-note" }, "In a field, Ctrl+Z undoes your typing. To undo a change already made, use Undo in the toolbar."));
  form.replaceChildren(...children);
  if (typing && typing.node === node.id) {
    const input = form.elements.namedItem(typing.field);
    if (input) input.value = typing.value;
  }
  if (activeField) {
    const input = form.elements.namedItem(activeField);
    input?.focus();
    if (typing && typing.node === node.id && typing.start !== null) input?.setSelectionRange(typing.start, typing.end);
  }
}

// The inspector's text section. A font is a family name, a stack, or a font token as var(--name).
const FONT_STACKS = ["system-ui, sans-serif", "Georgia, serif", "ui-monospace, monospace", "Helvetica, Arial, sans-serif", "\"Times New Roman\", serif"];
const FONT_WEIGHTS = [["", "Default"], ["100", "Thin"], ["200", "Extra light"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]];
const TEXT_ALIGN = [["", "Default"], ["start", "Start"], ["center", "Centre"], ["end", "End"], ["justify", "Justify"]];
function textSection(doc, style) {
  const value = (name) => (typeof style[name] === "string" ? style[name] : "");
  const input = (name, label, extra = {}) => {
    const control = el("input", { id: `inspect-${name.replace(/[^a-z-]/gu, "-")}`, name, value: value(name.slice(6)), autocomplete: "off", ...extra });
    control.dataset.original = control.value;
    return el("label", { for: control.id }, label, control);
  };
  const select = (name, label, choices) => {
    const current = value(name.slice(6));
    const known = choices.some(([option]) => option === current);
    // A value the list does not name stays shown, as it is.
    const options = known ? choices : [...choices, [current, current]];
    const control = el("select", { id: `inspect-${name.replace(/[^a-z-]/gu, "-")}`, name }, ...options.map(([option, text]) => el("option", { value: option, selected: option === current }, text)));
    control.dataset.original = current;
    return el("label", { for: control.id }, label, control);
  };
  // The project's font tokens first, then common stacks.
  const system = doc === null ? null : designSystemOf(doc);
  const fonts = [...(system?.props.tokens ?? []).filter((token) => token.type === "fontFamily").map((token) => `var(${token.name})`), ...FONT_STACKS];
  const list = el("datalist", { id: "font-families" }, ...fonts.map((font) => el("option", { value: font })));
  return el("fieldset", { id: "inspect-text-style", class: "layout" },
    el("legend", {}, "Text"),
    input("style:font-family", "Font", { list: "font-families", spellcheck: "false" }), list,
    el("div", { class: "pair" }, select("style:font-weight", "Weight", FONT_WEIGHTS), select("style:text-align", "Align", TEXT_ALIGN)),
    el("div", { class: "pair" }, input("style:line-height", "Line height"), input("style:letter-spacing", "Letter spacing")));
}

// Values that are numbers without a unit: a bare number stays one (1.5 is a line height, not 1.5px).
const UNITLESS = new Set(["background", "color", "line-height", "font-weight", "opacity", "z-index", "flex-grow", "flex-shrink", "order"]);

function onInspectorChange(event) {
  const input = event.target;
  const nodeId = $("inspector").dataset.nodeId;
  if (!nodeId || !state.document?.nodes[nodeId] || input.value === input.dataset.original) return;
  const value = input.value.trim();
  input.dataset.original = input.value;
  if (input.name === "name") commit([{ type: "set-props", nodeId, ...(value === "" ? { set: {}, unset: ["name"] } : { set: { name: value } }) }], "Rename layer");
  else if (input.name === "text") commit(setText(textLayerOf(state.document, nodeId) ?? nodeId, input.value), "Edit text");
  else if (input.name === "classes") {
    // Each class once, in the order given; HTML separates them by ASCII whitespace only.
    const names = [...new Set(value.split(/[\t\n\f\r ]+/u).filter((name) => name !== ""))].join(" ");
    input.value = names;
    input.dataset.original = names;
    const attributes = { ...(state.document.nodes[nodeId].props?.attributes ?? {}) };
    if ((attributes.class ?? "") === names) return;
    if (names === "") delete attributes.class;
    else attributes.class = names;
    commit([{ type: "set-props", nodeId, ...(Object.keys(attributes).length === 0 ? { set: {}, unset: ["attributes"] } : { set: { attributes } }) }], names === "" ? "Remove classes" : "Change classes");
  }
  else if (input.name.startsWith("style:")) {
    const property = input.name.slice(6);
    const normalized = /^-?\d+(\.\d+)?$/u.test(value) && !UNITLESS.has(property) ? `${value}px` : value;
    // A value the canvas would not draw is said, not stored (an unclosed quote, a semicolon).
    const problem = normalized === "" ? null : styleDeclarationProblem(property, normalized);
    if (problem !== null) {
      setStatus(`Not changed: ${problem}.`);
      input.value = input.dataset.original = typeof state.document.nodes[nodeId]?.props?.style?.[property] === "string" ? state.document.nodes[nodeId].props.style[property] : "";
      return;
    }
    commit(setStyle(state.document, nodeId, { [property]: normalized === "" ? null : normalized }), "Change style");
  }
}

function actorLabel(entry) {
  if (entry.actor === state.user.actorId) return state.user.displayName ?? "You";
  return typeof entry.actorName === "string" && entry.actorName !== "" ? entry.actorName : entry.actor;
}

function renderHistory() {
  const list = $("history");
  if (state.document === null) {
    list.replaceChildren();
    return;
  }
  // Changes from before this session (#231) are listed too; only this session's can be reverted.
  list.replaceChildren(...[...state.history].reverse().map((entry) => el("li", { class: `${entry.actorKind === "agent" ? "agent" : "user"}${entry.earlier ? " earlier" : ""}`, "data-transaction": entry.transactionId },
    el("span", { class: "intent" }, entry.intent ?? "Edit"),
    el("span", { class: "who" },
      actorLabel(entry),
      entry.actorKind === "agent" ? el("span", { class: "kind" }, " · agent") : null,
      entry.tool && !/^(?:ninerr|lilac):/u.test(entry.tool) ? ` · ${entry.tool}` : null,
      ` · revision ${entry.revision}`,
      entry.earlier ? " · before this session" : null),
    state.revertible.includes(entry.transactionId) ? el("button", { type: "button", class: "revert", "aria-label": `Revert ${entry.intent ?? "change"} by ${actorLabel(entry)}`, onclick: () => revert(entry) }, "Revert") : null)));
  if (state.history.length === 0) list.replaceChildren(el("li", {}, el("span", { class: "who" }, state.revision === 0 ? "No changes yet." : "No changes listed since this project was opened.")));
}

function renderToolbar() {
  const focused = document.activeElement;
  const open = state.document !== null;
  $("project-name").textContent = state.project ?? "No project open";
  $("action-undo").disabled = !open || !state.canUndo;
  $("action-redo").disabled = !open || !state.canRedo;
  // Next to Undo: the latest agent change this person may undo, named.
  const agentChange = open ? latestAgentChange() : null;
  const undoAgent = $("action-undo-agent");
  const named = agentChange === null ? null : `${agentChange.intent ?? "Change"} by ${actorLabel(agentChange)}`;
  undoAgent.hidden = named === null;
  undoAgent.setAttribute("aria-label", named === null ? "Undo agent change" : `Undo agent change: ${named}`);
  undoAgent.title = named ?? "";
  $("action-insert-box").disabled = !open;
  $("action-insert-text").disabled = !open;
  renderPages();
  $("action-delete").disabled = !open || state.selection.length === 0;
  $("action-group").disabled = !open || state.selection.length === 0;
  $("action-save").disabled = !open;
  $("action-import").disabled = !open;
  $("action-code").disabled = !open;
  $("action-research").disabled = !open;
  $("action-tokens").disabled = !open;
  $("action-components").disabled = !open;
  $("zoom-level").textContent = `${Math.round(canvas.viewport.zoom * 100)}%`;
  $("revision").textContent = open ? `Revision ${state.revision}` : "";
  document.title = state.project ? `${state.project} — Ninerr` : "Ninerr";
  // A button disabled or hidden while it has focus (Group or Delete with nothing left selected,
  // Undo with nothing left to undo) would drop focus to the page. It moves once the caller has
  // updated the tree too, or it would land on a row about to go.
  if (focused instanceof HTMLButtonElement && focused.closest("header") !== null && (focused.disabled || focused.hidden)) {
    queueMicrotask(() => {
      if (document.activeElement === focused || document.activeElement === document.body) focusLayers();
    });
  }
}

/**
 * Where focus goes when the control holding it goes away: never a command, which a held or further
 * Enter would run. In the tree Enter selects; on the canvas it does nothing.
 */
function focusLayers() {
  const row = document.querySelector("#layers [role=treeitem][tabindex='0']");
  if (row !== null) row.focus();
  else canvas.stage.focus({ focusVisible: true });
}

function renderChrome() {
  renderToolbar();
}

function renderAll() {
  renderToolbar();
  renderLayers();
  renderInspector();
  renderHistory();
}

// ---------- wiring ----------

function isTextInput(target) {
  return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
}

// Alt+A, D, W, S, H, V align the selection; with Shift, H and V space it evenly. By the key's
// place, as Option+letter types another character on a Mac.
const ALIGN_KEYS = { KeyA: "left", KeyD: "right", KeyW: "top", KeyS: "bottom", KeyH: "center", KeyV: "middle" };

function onGlobalKey(event) {
  if ($("dialog").open) return;
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat && !isTextInput(event.target) && state.selection.length >= 2) {
    if (event.shiftKey && (event.code === "KeyH" || event.code === "KeyV")) {
      event.preventDefault();
      if (canvas.distribute(event.code === "KeyH" ? "horizontal" : "vertical") === 0) setStatus("Select three layers or more that are shown to space them evenly.");
      return;
    }
    if (!event.shiftKey && Object.hasOwn(ALIGN_KEYS, event.code)) {
      event.preventDefault();
      if (canvas.align(ALIGN_KEYS[event.code]) === 0) setStatus("Select two layers or more that are shown to align them.");
      return;
    }
  }
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || isTextInput(event.target)) return;
  const key = event.key.toLowerCase();
  // By the key's place, not its character: Option+Z on a Mac, or AltGr+Z, types another one.
  if (event.code === "KeyZ" && event.altKey && !event.shiftKey) {
    event.preventDefault();
    undoAgentChange();
    return;
  }
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoRedo("undo");
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault();
    undoRedo("redo");
  } else if (key === "s") {
    event.preventDefault();
    save();
  } else if (key === "g" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    groupSelection();
  }
}

async function main() {
  canvas = await mountCanvas($("canvas"), {
    onCommit: (operations, intent, meta) => commit(operations, intent, meta?.revision),
    // A layer inside the selected instance, picked by double-click: the Components dialog edits it.
    onTarget: (target) => {
      setStatus(target !== null ? "Editing a layer inside the instance: open Components to change it for this instance." : "");
      if (redrawComponents !== null && redrawComponents() === false) redrawComponents = null;
    },
    onSelect: (ids) => {
      // The canvas reports the selection after every update; redraw only when it changed,
      // and not while a change is being applied (applyChange updates the panels itself).
      if (applying || ids.join("\n") === state.selection.join("\n")) return;
      state.selection = ids;
      shareSelection();
      if (ids.length > 0) state.focusedLayer = ids.at(-1);
      renderLayers();
      renderInspector();
      renderToolbar();
    },
  });
  canvas.stage.addEventListener("wheel", () => requestAnimationFrame(renderToolbar), { passive: true });
  canvas.stage.addEventListener("keyup", renderToolbar);
  // The skip link lands on the canvas itself, which takes the keyboard commands.
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    canvas.stage.focus({ focusVisible: true });
  });
  $("action-projects").addEventListener("click", openProjectsDialog);
  $("action-undo").addEventListener("click", () => undoRedo("undo"));
  $("action-redo").addEventListener("click", () => undoRedo("redo"));
  $("action-undo-agent").addEventListener("click", () => undoAgentChange());
  $("action-insert-box").addEventListener("click", () => insert("box"));
  $("action-add-page").addEventListener("click", addPage);
  $("page-select").addEventListener("change", (event) => showPage(event.target.value));
  // Choosing the page already chosen changes nothing; Show fits the canvas to it again.
  $("action-show-page").addEventListener("click", () => showPage($("page-select").value));
  $("action-insert-text").addEventListener("click", () => insert("text"));
  $("action-delete").addEventListener("click", deleteSelection);
  $("action-zoom-in").addEventListener("click", () => { canvas.zoomBy(1.25); renderToolbar(); });
  $("action-zoom-out").addEventListener("click", () => { canvas.zoomBy(0.8); renderToolbar(); });
  $("action-fit").addEventListener("click", () => { canvas.fit(); renderToolbar(); });
  $("action-save").addEventListener("click", save);
  $("action-import").addEventListener("click", openImportDialog);
  $("action-code").addEventListener("click", openCodeDialog);
  $("action-research").addEventListener("click", openResearchDialog);
  $("action-tokens").addEventListener("click", openTokensDialog);
  $("action-components").addEventListener("click", openComponentsDialog);
  $("action-component-sources").addEventListener("click", openComponentSourcesDialog);
  $("action-agents").addEventListener("click", openAgentsDialog);
  $("layers").addEventListener("keydown", onLayersKey);
  $("layers").addEventListener("click", onLayersClick);
  $("layers").addEventListener("dragstart", onLayersDragStart);
  $("layers").addEventListener("dragover", onLayersDragOver);
  $("layers").addEventListener("drop", onLayersDrop);
  $("layers").addEventListener("dragend", onLayersDragEnd);
  $("layers").addEventListener("dragleave", (event) => {
    if (!$("layers").contains(event.relatedTarget)) clearDropMarks();
  });
  $("action-group").addEventListener("click", () => groupSelection());
  $("inspector").addEventListener("change", onInspectorChange);
  $("inspector").addEventListener("submit", (event) => event.preventDefault());
  document.addEventListener("keydown", onGlobalKey);
  renderAll();

  state.client = await connect(window);
  if (state.client === null) {
    showDialog("Open Ninerr from its launcher", () => [el("p", {}, "This page needs the link Ninerr prints or opens when it starts. Start Ninerr again to get a new one.")], { dismissable: false });
    return;
  }
  // Each change names the project this tab shows, so it cannot land in one another tab opened (#260).
  state.client.followProject(() => state.project);
  let session;
  try {
    session = await requestLoad();
  } catch (error) {
    if (error instanceof HostError && error.status === 401) {
      forgetToken(window);
      showDialog("This Ninerr session has ended", () => [el("p", {}, "Ninerr was restarted or the link expired. Open Ninerr again from its launcher.")], { dismissable: false });
      return;
    }
    setStatus(describeError(error));
    return;
  }
  listenForChanges();
  state.client.get("/api/confirmations").then(({ pending }) => showConfirmations(pending), () => {});
  if (session.project === null) await openProjectsDialog();
  else setStatus(`Opened ${session.project}.`);
  // Ready once changes reach this copy (#302): the stream is open and the copy caught up, or
  // the stream was refused. A stream that never answers does not hold the editor back.
  await Promise.race([streamSettled, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  document.documentElement.dataset.ready = "true";
}

main().catch((error) => setStatus(`Ninerr could not start: ${error?.message ?? error}`));
