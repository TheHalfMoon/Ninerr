# Ninerr and MCP

Ninerr runs an MCP server so that an agent can read and edit the open design document. This page covers what the server offers, how an agent connects to it, and how each call is authorized.

## Status

| Piece | State | Where |
| --- | --- | --- |
| The tool catalog and its classification (read / write / consequential / unknown) | Implemented | `packages/mcp-protocol/src/tools.mjs` |
| Contract validation (client identity, transports, tool definitions, server config, tool results, the server's tools against the catalog) | Implemented | `packages/mcp-protocol/src/index.mjs` |
| Tool-call authorization through the collaboration access oracle | Implemented | `packages/mcp-protocol/src/authorization.mjs`, `tests/mcp-authorization.test.mjs` |
| The MCP server: loopback HTTP inside the studio host, and its tools | Implemented | `packages/studio-host/src/mcp.ts`, `tests/mcp-server.test.mjs` |
| The stdio relay | Implemented | `packages/studio-host/src/relay.ts`, `scripts/ninerr-mcp.mjs`, `tests/mcp-relay.test.mjs` |

## The headless engine (no editor needed)

`node bin/ninerr.mjs mcp [--projects <folder>]` runs Ninerr as an MCP server on stdio, for an agent's own client to start. No editor, browser or desktop app, no account and no network is needed (`docs/HEADLESS.md`). The projects folder is `--projects`, or `NINERR_PROJECTS`, or "Ninerr Projects" in your home folder.

- **Lifecycle tools,** which belong to the engine: `list_projects`, `create_project`, `open_project`, `save_project` and `close_project`. A project's name is its folder's name inside the projects folder, never a path. Opening holds the project's lock, as the editor does, so a project open in the editor or in another agent's engine is refused until it is released. Ending the client's session closes the project.
- **Every document tool** below works the same as in the editor's server. It goes through the same single writer, authorization, revision checks, dry runs and history.
- **Identity.** Only the client that started the process can speak to it, so no token is needed. The agent is `agent-local-<client>`, named from the client's `initialize`, and History shows it as "<client> (local agent)". It is granted read and document-write on the project it opens, and nothing else.
- **Deleting** (`delete_layers`, `delete_token`) is put to the person through the client, with MCP elicitation, showing the same plain summary the editor shows and bound to the exact call. Only an answer that approves deletes. Declining, cancelling, an error or no answer deletes nothing. A client that cannot ask (it did not declare elicitation) is refused with an explanation. Nothing is approved without the person.

## Connecting an agent

1. In Ninerr, connect an agent. Ninerr shows its credential once.
2. Configure the MCP client to use one of the transports. Transports are `stdio` and `http` (`MCP_TRANSPORTS`).
   - **stdio:** run `node scripts/ninerr-mcp.mjs --projects <your Ninerr projects folder>` (or `npm run mcp`), with `NINERR_MCP_TOKEN` set to the credential. The relay finds the running Ninerr through the discovery file in the projects folder, or takes `--url`. It only connects to a loopback address.
   - **http:** send MCP's Streamable HTTP requests to `POST http://127.0.0.1:<port>/mcp` on Ninerr's loopback listener, with `Authorization: Bearer <credential>`. Each request carries one JSON-RPC message and gets one JSON answer.

The server identifies itself as `ninerr` and tells the agent to call `guide` first.

## Tools

`MCP_TOOL_NAMES` is the catalog: the 37 tools the server offers, and no others. The server checks its own definitions against it with `assertMCPToolSurface` when it loads. `classifyTool(name)` gives each tool its class:

| Class | Tools | Capability required |
| --- | --- | --- |
| read | `project_info`, `layer_tree`, `layer_details`, `layer_children`, `find_layers`, `selection`, `layer_code`, `search_design_references`, `get_design_reference`, `guide`, `finish_task`, `design_tokens`, `list_components`, `instance_layers`, `search_components`, `get_component` | `read` |
| write | `create_frame`, `set_text`, `rename_layers`, `set_styles`, `set_attributes`, `set_layout`, `move_layers`, `duplicate_layers`, `set_token`, `add_token_mode`, `rename_token`, `set_layer_modes`, `create_component`, `add_component_property`, `insert_instance`, `set_instance_values`, `set_instance_override`, `reset_instance`, `detach_instance` | `document-write` |
| consequential | `delete_layers`, `delete_token` | `document-write` plus a confirmation |
| unknown | any other name | denied without consulting a policy |

So the 16 read-only tools need only `read`.

- **Reading.**
  - `guide`: how Ninerr documents, layers and edits work; the server asks the agent to call it first.
  - `project_info`: the open project and document.
  - `layer_tree`, `layer_children` and `layer_details`: the layers.
  - `find_layers`: search by name or text.
  - `selection`: what the person has selected in the editor.
  - `layer_code`: a layer as a JSX component; with `format: "tailwind"`, its styles as Tailwind classes; with `format: "html"`, a standalone HTML page that loads and runs nothing.
  - `design_tokens`: the design system's collections, modes and tokens, with how many layer values use each (ADR-0004).
  - `list_components` and `instance_layers`: the components with their properties and instance counts, and the layers an instance draws, with the path and node each override takes (ADR-0005).
  - `search_components` and `get_component`: the records Ninerr has of component sources' components (Meta Astryx, at a pinned commit; `packages/component-sources/src/records.mjs`). The first finds components by name or purpose; the second gives one's exact props, variants, accessibility criteria, limitations and provenance. They read records that ship with Ninerr: nothing is fetched, and no source code is given or imported.
  - `search_design_references` and `get_design_reference`: the local reference pack the person has read into the open project. They return public references with their rights, never file bytes. They take no directory, URL or token, and with no pack read the answer says so; nothing is fetched instead.
- **Dry runs and revisions** (ADR-0006, in part). Every write and consequential tool also takes:
  - `dryRun: true`, which checks the change as it would be made (the caller's access, the document rules, the stylesheet budget) and answers `{ dryRun: true, wouldChange, operations, revision }`. It makes nothing, and a dry-run delete asks the person nothing, so it does not check what only the person's approval would. A layer it would create has an id there that a real call does not reuse.
  - `baseRevision`, the revision the agent read. Once the caller is authorized, a change is refused when the document has moved on since; and the change is made at that revision, so a delete the person approves after the document changed is refused too.
- **Editing.** Every write is one history transaction, attributed to the agent. The person sees it live on the canvas and can undo it with **Undo agent change**, next to Undo (Ctrl+Alt+Z; Cmd+Option+Z on a Mac): it reverts the agent's latest change in this session, and then the one before. `finish_task` changes nothing; it tells Ninerr the agent is done with some layers.
- **Only the project the agent has read.** Tools act on the project open in Ninerr. An agent may write or delete only in the project it last connected to (`initialize`) or read with `project_info`, `layer_tree`, `layer_details`, `layer_children`, `find_layers`, `selection` or `layer_code` (#260). Otherwise the call is refused, before the person is asked anything, and the agent is told to call `project_info` first. Two cases are refused this way:
  - the person has opened another project since the agent last read;
  - Ninerr has no record of the agent, for example after a restart or for a client that never sent `initialize`.

  Connecting again counts as reading, so an agent that reconnects can change whatever project is open. The record is kept per agent, so clients that share one agent credential share it.
- **Design tokens.** `set_token` adds a token or changes its values (creating the design system with the first), `add_token_mode` adds a mode, `rename_token` renames a token and every use in one change, and `set_layer_modes` gives layers a mode. A layer uses a token as `var(--name)` through `set_styles`. `delete_token` is consequential: the person approves it, seeing how many values on how many layers use the token, which tokens alias it and what replaces it, and a token in use needs its replacement. The approval holds only while the token, its uses and its aliases stay as they were: if any of them changes, the person is asked again.
- **Components.** `create_component` makes a layer a component, `add_component_property` gives it a text, shown or variant property, `insert_instance` places an instance, `set_instance_values` and `set_instance_override` change one instance (the component never), `reset_instance` takes its overrides off, and `detach_instance` writes it, overrides and all, as real layers that no longer follow the component. Each is one change; the person reverts an agent's changes latest first.
- **Names look like what they are** (#64). In a write or consequential call, every label the agent gives (a layer, component, property or mode name, a variant option or default, a token's name, collection or description) is refused if it holds a control or format character (bidi overrides and isolates, zero-width or tag characters), a line or paragraph separator, a blank-looking filler, or a variation selector that varies nothing. ZWJ and ZWNJ stay legal, for emoji sequences and complex scripts, and a description may break lines. The refusal comes before the person is asked anything and before anything changes, a dry run included, so a name in an approval prompt reads as what it is. Each tool's labels are listed in `mcp.ts`, and a write tool that takes a label-like field it does not list stops the server loading. Text content and CSS values are not labels. What the person is asked to approve shows any such character in a layer's name or text, one an imported page or an older project could hold, written out as `[U+XXXX]`, so it can neither hide nor reorder the words around it. The rule is the one `@ninerr/decision-assurance` and `@ninerr/visual-git` apply.
- **Deleting.** `delete_layers` and `delete_token` ask the person to approve the call in the editor. The call waits up to 50 seconds for an answer (`CONFIRMATION_WAIT_MS`). If no answer comes, the agent is told to call again with the same arguments, and an approval stays usable for that exact call for 5 minutes.

## Authorizing a call

```js
import { authorizeMCPToolCall, requireMCPToolCall, mcpArgumentsSha256 } from "@ninerr/mcp-protocol";

const decision = authorizeMCPToolCall(policy, {
  actor,             // the identity the server authenticated for this session
  toolName: "set_styles",
  arguments: { ... },// a JSON object, or absent
  at: "2026-10-07T12:00:00.000Z",
  linkGrantId,       // optional
  confirmation,      // required for consequential tools
});
// decision.outcome: "allowed" | "denied" | "confirmation-required" | "not-found"
```

`policy` is a collaboration document access policy. `evaluateAccess` evaluates it with transport `"mcp"`.

A decision carries `toolClass`, `capability`, `documentId`, `policyRevision` and a `reason`. If the tool is unknown, its name appears in the reason, quoted and truncated.

The possible outcomes are:
- `allowed`;
- `confirmation-required`;
- `denied`;
- `not-found`, for a deleted document.

`requireMCPToolCall` throws `MCPAuthorizationError`, with `.decision`, unless the outcome is `allowed`.

Malformed input throws:
- **`MCPContractError`**, in these cases:
  - the call or the confirmation has unsupported keys;
  - `toolName` is empty;
  - `at` or `confirmedAt` is not a real ISO-8601 UTC instant;
  - for a known tool, `arguments` is not a JSON object.
- **`CollaborationValidationError`**, from `evaluateAccess`, when a known tool's `actor`, `policy` or `linkGrantId` is malformed.

An unknown tool is denied as soon as `toolName` and `at` are read. Its arguments, actor and policy are never looked at.

### Confirmation for consequential tools

A consequential call needs `confirmation: { documentId, toolName, argumentsSha256, actorId, confirmedAt }`. It must meet all of these conditions:
- **It binds to this exact call on this document.** It names the same document and tool, and `argumentsSha256` equals `mcpArgumentsSha256(arguments)`, the SHA-256 of the canonical JSON of the arguments.
- **A person confirms it.** That is the calling user, or for an agent, the agent's owning user, and never the agent itself. The confirming person must hold `document-write` on the document through an actor grant; a link grant does not count.
- **It is recent.** `confirmedAt` is not after `at`, and it is within `MCP_CONFIRMATION_WINDOW_MS` (5 minutes) of it.

## What the server guarantees

`authorizeMCPToolCall` cannot tell who built its inputs, so the server in `packages/studio-host/src/mcp.ts` meets these obligations:
- It takes `actor` from the agent the request's credential belongs to, and an agent's `ownerActorId` is the local person.
- `confirmation` comes only from the editor's own approval flow with that person.
- It never takes either from the MCP client's request payload.
- It authorizes every `tools/call` before anything is dispatched, including before a consequential call asks the person.
- It applies every edit through the studio host's single writer, as a history transaction attributed to the agent.
- It grants no ambient filesystem or network authority.

## Tool names before the rename

Before the rename to Ninerr, the server used other names for the same 16 tools. They are not accepted any more: nothing had been released under them, so no aliases are kept, and a call by an old name is an unknown tool.

History entries recorded before the rename keep the tool name they were made with.

| Before | Now |
| --- | --- |
| `get_basic_info` | `project_info` |
| `get_tree_summary` | `layer_tree` |
| `get_node_info` | `layer_details` |
| `get_children` | `layer_children` |
| `find_nodes` | `find_layers` |
| `get_selection` | `selection` |
| `get_jsx` | `layer_code` |
| `get_guide` | `guide` |
| `finish_working_on_nodes` | `finish_task` |
| `create_artboard` | `create_frame` |
| `set_text_content` | `set_text` |
| `rename_nodes` | `rename_layers` |
| `update_styles` | `set_styles` |
| `move_nodes` | `move_layers` |
| `duplicate_nodes` | `duplicate_layers` |
| `delete_nodes` | `delete_layers` |
