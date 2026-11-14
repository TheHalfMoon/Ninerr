import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { LEGACY_PROJECT_DIRECTORY, PROJECT_FILES } from "@ninerr/persistence";
import { AGENT_CAPABILITIES } from "./agents.ts";
import { StudioError } from "./errors.ts";
import { prepareProjectsFolder } from "./projects-folder.ts";
import { ConfirmationBroker, handleMcpMessage, type McpContext, type PendingConfirmation } from "./mcp.ts";
import { ReferenceCatalog } from "./reference-catalog.ts";
import { StudioSession, assertProjectName, type StudioActor } from "./session.ts";

// Ninerr's headless engine: an MCP server on stdio that needs no editor, browser or desktop
// app (docs/HEADLESS.md). The agent's own client starts it, so it answers only that client;
// no listener exists for anyone else to reach, and no token is needed. It owns the project
// lifecycle (list, create, open, save, close) inside one projects folder, and answers every
// document tool through the same handleMcpMessage, StudioSession (the single writer),
// authorization and revision checks the studio host uses. A project it opens holds the
// project's lock, as the editor does, so the two never write one project at once.
//
// A consequential call is put to the person through the client (MCP elicitation) when the
// client can ask; otherwise it is refused. It is never approved without the person.

const MAX_LINE_BYTES = 1024 * 1024;
// How long a consequential call waits for the person's answer in the client.
const HEADLESS_CONFIRMATION_WAIT_MS = 120_000;
// Some clients keep an MCP server running between conversations. A project left open that long
// stays locked to everyone else, so after this long with no call the engine closes it; the
// agent's next call is told to open it again.
const IDLE_CLOSE_MS = 10 * 60_000;
const OWNER: StudioActor = { actorId: "local-user", kind: "user", accessClass: "member", displayName: "You" };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface HeadlessOptions {
  projectsRoot: string;
  input: Readable;
  output: Writable;
  now?: () => string;
  /** Overrides the wait for the person's answer to a consequential call (tests). */
  confirmationWaitMs?: number;
  /** Overrides how long an open project may sit with no call before it is closed (tests). */
  idleCloseMs?: number;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const projectName = { type: "string", minLength: 1, maxLength: 128, description: "A project's name: its folder's name in the projects folder, not a path." };

// The lifecycle tools, the engine's own: they act on the projects folder, before any document exists.
const LIFECYCLE_TOOLS = [
  { name: "list_projects", title: "List projects", description: "The projects in Ninerr's projects folder, and which one is open.", inputSchema: object({}) },
  { name: "create_project", title: "Create a project", description: "Create a project in the projects folder and open it. Then design in it with the other tools.", inputSchema: object({ name: projectName, title: { type: "string", maxLength: 200 } }, ["name"]) },
  { name: "open_project", title: "Open a project", description: "Open a project from the projects folder, closing the one open now. A project the Ninerr editor or another agent has open is refused.", inputSchema: object({ name: projectName }, ["name"]) },
  { name: "save_project", title: "Save the project", description: "Write a snapshot of the open project. Every change is already kept in its journal as it is made; a snapshot makes the next open faster.", inputSchema: object({}) },
  { name: "close_project", title: "Close the project", description: "Close the open project, releasing it for the editor or another agent.", inputSchema: object({}) },
];
const LIFECYCLE = new Set(LIFECYCLE_TOOLS.map((tool) => tool.name));

const toolResult = (value: Json, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : { structuredContent: typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value } }),
});

/** The agent's actor: one per client name, shown in history as that client, run by the local person. */
export function localAgentActor(clientName: unknown): StudioActor {
  const raw = typeof clientName === "string" ? clientName : "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40) || "mcp";
  // The name a person reads: printable characters only, nothing that hides or reorders text.
  const shown = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu, "").trim().slice(0, 60) || "MCP client";
  return { actorId: `agent-local-${slug}`, kind: "agent", accessClass: "service", displayName: `${shown} (local agent)`, ownerActorId: OWNER.actorId };
}

export class HeadlessEngine {
  readonly #projectsRoot: string;
  readonly #now: () => string;
  readonly #write: (message: unknown) => void;
  readonly #references = new ReferenceCatalog();
  readonly #lastRead = new Map<string, string>();
  readonly #confirmations: ConfirmationBroker;
  readonly #waitMs: number;
  readonly #idleMs: number;
  #idle: ReturnType<typeof setTimeout> | null = null;
  #session: StudioSession | null = null;
  #actor: StudioActor = localAgentActor(undefined);
  #canAsk = false;
  #initialized = false;
  #nextRequest = 1;
  readonly #asked = new Set<string>();
  readonly #answers = new Map<string | number, (message: any) => void>();

  constructor(options: { projectsRoot: string; now?: () => string; write: (message: unknown) => void; confirmationWaitMs?: number; idleCloseMs?: number }) {
    this.#projectsRoot = options.projectsRoot;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#write = options.write;
    this.#waitMs = options.confirmationWaitMs ?? HEADLESS_CONFIRMATION_WAIT_MS;
    this.#idleMs = options.idleCloseMs ?? IDLE_CLOSE_MS;
    this.#confirmations = new ConfirmationBroker((pending) => this.#ask(pending));
  }

  get session(): StudioSession | null {
    return this.#session;
  }

  /** Answer one message from the client: a request or notification, or its answer to one of ours. */
  async receive(message: unknown): Promise<unknown> {
    this.#keepOpen();
    if (message !== null && typeof message === "object" && !Array.isArray(message) && !("method" in message) && "id" in message) {
      const resolve = this.#answers.get((message as any).id);
      if (resolve !== undefined) {
        this.#answers.delete((message as any).id);
        resolve(message);
      }
      return null;
    }
    const { id, method, params } = (message ?? {}) as Record<string, any>;
    // Who the agent is, and whether its client can ask the person, are set once, by the first initialize.
    if (method === "initialize" && !this.#initialized && params !== null && typeof params === "object") {
      this.#initialized = true;
      this.#actor = localAgentActor(params?.clientInfo?.name);
      this.#canAsk = params?.capabilities?.elicitation !== undefined && params?.capabilities?.elicitation !== null;
    }
    if (method === "initialize") {
      const answer: any = await handleMcpMessage(this.#context(), this.#actor, message);
      if (answer?.result) answer.result.instructions = "Ninerr design documents, with no editor needed. Call list_projects, then open_project or create_project; call guide for how to design; when done, save_project and close_project, which releases the project for the person and other agents.";
      return answer;
    }
    if (method === "tools/list") {
      const answer: any = await handleMcpMessage(this.#context(), this.#actor, message);
      if (answer?.result?.tools) answer.result.tools = [...LIFECYCLE_TOOLS, ...answer.result.tools];
      return answer;
    }
    if (method === "tools/call" && LIFECYCLE.has(params?.name)) {
      if (typeof id !== "string" && typeof id !== "number") return null;
      return { jsonrpc: "2.0", id, result: this.#lifecycle(params.name, params?.arguments ?? {}) };
    }
    return handleMcpMessage(this.#context(), this.#actor, message);
  }

  /** The client has gone: nothing waiting for the person can be approved now. */
  endInput(): void {
    this.#confirmations.drop(() => true);
    for (const resolve of this.#answers.values()) resolve({ error: { message: "the client has gone" } });
    this.#answers.clear();
  }

  /** Close the open project, if any. */
  close(): void {
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.endInput();
    this.#closeSession();
  }

  #context(): McpContext {
    return {
      session: () => this.#session,
      selection: () => [],
      references: this.#references,
      confirmations: this.#confirmations,
      now: this.#now,
      lastRead: this.#lastRead,
      confirmationWaitMs: this.#waitMs,
      confirmationUnavailable: () => (this.#canAsk ? null : "Deleting needs the person's approval, and this MCP client cannot ask them (it does not support MCP elicitation), so the change was not made. Ask the person to approve the deletion in a client that can ask, or to make it themselves."),
    };
  }

  #lifecycle(name: string, args: any) {
    try {
      if (args === null || typeof args !== "object" || Array.isArray(args)) throw new StudioError(400, "invalid-arguments", "arguments must be an object");
      const allowed = (LIFECYCLE_TOOLS.find((tool) => tool.name === name)!.inputSchema as any).properties;
      for (const key of Object.keys(args)) if (!Object.hasOwn(allowed, key)) throw new StudioError(400, "invalid-arguments", `this tool takes no argument ${JSON.stringify(key.slice(0, 40))}`);
      if (name === "list_projects") return toolResult({ projectsFolder: this.#projectsRoot, projects: this.#projects(), open: this.#session?.name ?? null });
      if (name === "create_project" || name === "open_project") {
        const project = assertProjectName(args.name);
        if (args.title !== undefined && typeof args.title !== "string") throw new StudioError(400, "invalid-arguments", "title must be text");
        if (name === "open_project" && this.#session?.name === project) this.#closeSession();
        const next = StudioSession.open({ projectsRoot: this.#projectsRoot, name: project, owner: OWNER, now: this.#now, ...(name === "create_project" ? { create: { title: args.title } } : {}) });
        this.#closeSession();
        next.setAgentGrants([{ principalKind: "actor", principalId: this.#actor.actorId, capabilities: [...AGENT_CAPABILITIES] }]);
        this.#session = next;
        // Opening a project is the agent reading it: it may change it now (#260).
        this.#lastRead.set(this.#actor.actorId, next.name);
        return toolResult({ project: next.name, revision: next.revision, created: name === "create_project", layers: Object.keys((next.document as any).nodes).length });
      }
      const session = this.#session;
      if (session === null) throw new StudioError(409, "no-project", "No project is open. Call open_project or create_project first.");
      if (name === "save_project") return toolResult({ project: session.name, ...session.checkpoint() });
      this.#closeSession();
      return toolResult({ closed: session.name });
    } catch (error) {
      return toolResult(error instanceof StudioError ? error.message : "Ninerr could not complete the call.", true);
    }
  }

  #projects(): string[] {
    return readdirSync(this.#projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (existsSync(join(this.#projectsRoot, entry.name, PROJECT_FILES.directory)) || existsSync(join(this.#projectsRoot, entry.name, LEGACY_PROJECT_DIRECTORY))))
      .map((entry) => entry.name)
      .sort();
  }

  // Each message restarts the idle clock; when it runs out with nothing waiting for the person, the project is closed.
  #keepOpen(): void {
    if (this.#idle !== null) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      this.#idle = null;
      if (this.#session === null) return;
      // Something waits for the person: look again later, rather than leave the project open for good.
      if (this.#confirmations.pending().length > 0) this.#keepOpen();
      else this.#closeSession();
    }, this.#idleMs);
    this.#idle.unref?.();
  }

  #closeSession(): void {
    const session = this.#session;
    if (session === null) return;
    const documentId = session.documentId;
    this.#confirmations.drop((item) => item.documentId === documentId);
    this.#session = null;
    session.close();
  }

  // Each new request for the person's approval is asked in the client, once; their answer decides it.
  #ask(pending: PendingConfirmation[]): void {
    for (const item of pending) {
      if (this.#asked.has(item.id)) continue;
      this.#asked.add(item.id);
      const decide = (approve: boolean) => {
        this.#asked.delete(item.id);
        try {
          this.#confirmations.decide(item.id, approve, this.#now());
        } catch {
          // Already decided, dropped or expired: nothing waits for this answer.
        }
      };
      if (!this.#canAsk) {
        queueMicrotask(() => decide(false));
        continue;
      }
      const id = `ninerr-ask-${this.#nextRequest++}`;
      // No answer before the call stops waiting is no approval: the request is declined, and a retry asks again.
      const unanswered = setTimeout(() => {
        if (this.#answers.delete(id)) decide(false);
      }, Math.max(0, this.#waitMs - 500));
      // Not unref'd: a call waiting for the person is work in progress; the answer, or the client going, clears it.
      this.#answers.set(id, (answer) => {
        clearTimeout(unanswered);
        const result = answer?.result;
        decide(answer?.error === undefined && result?.action === "accept" && result?.content?.approve === true);
      });
      this.#write({
        jsonrpc: "2.0",
        id,
        method: "elicitation/create",
        params: {
          message: `${item.agentName} asks to make this change in Ninerr, which cannot be undone by the agent alone:\n\n${item.summary}\n\nApprove it?`,
          requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "Approve this change", description: item.summary } }, required: ["approve"] },
        },
      });
    }
  }
}

/** Serve MCP on stdio until `input` ends; then close the open project. */
export async function runHeadless(options: HeadlessOptions): Promise<void> {
  const write = (message: unknown) => {
    options.output.write(`${JSON.stringify(message)}\n`);
  };
  prepareProjectsFolder(options.projectsRoot);
  const engine = new HeadlessEngine({ projectsRoot: options.projectsRoot, write, ...(options.now ? { now: options.now } : {}), ...(options.confirmationWaitMs ? { confirmationWaitMs: options.confirmationWaitMs } : {}), ...(options.idleCloseMs ? { idleCloseMs: options.idleCloseMs } : {}) });
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  const inflight = new Set<Promise<void>>();
  try {
    for await (const line of lines) {
      if (line.trim() === "") continue;
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "message too large" } });
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } });
        continue;
      }
      // Each message is answered as soon as it is ready, so a call waiting for the person
      // does not hold back the client's answer to that very question.
      const task = engine.receive(message).then((answer) => {
        if (answer !== null && answer !== undefined) write(answer);
      }, () => {
        const id = (message as any)?.id;
        write({ jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null, error: { code: -32603, message: "Ninerr could not complete the call" } });
      }).finally(() => inflight.delete(task));
      inflight.add(task);
    }
    // The client has gone: what waits for the person is denied, so every call settles and the
    // project is closed, releasing its lock, rather than left locked by an engine that exits.
    engine.endInput();
    await Promise.all(inflight);
  } finally {
    engine.close();
  }
}
