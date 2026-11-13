# Human acceptance protocols for a release candidate

Two of the release gates need a person: a clean-machine install, and a pass with a real screen reader (#376). Automated checks do not replace either one. CI already packages, smoke-tests and walks every archive through the release-candidate journey, and `auditAccessibility` checks the editor's markup. What neither can show is that a stranger's computer accepts the download, or what a screen reader actually says.

Each run is for **one exact candidate commit**. A result recorded for one commit is not evidence for another, even one that changes only documentation. Write each result to `docs/evidence/` with the date, the commit, the machine and who ran it, using the record template at the end. A step that was skipped or could not be done is recorded that way, and never as a pass.

## Getting the candidate's files

Before a tag exists, the files come from a `Release Evidence` run of the candidate commit, started by hand (Actions, Release Evidence, Run workflow, on the branch whose head is the candidate). Use only a run whose jobs all passed. Its artifact `ninerr-release-<sha>` holds the three desktop archives, the evidence bundle and `SHA256SUMS`, and `<sha>` must be the candidate commit.

These files are **not attested**: only a pushed tag is signed (`docs/RELEASE.md`). Before a tag, the checks are the run itself and `SHA256SUMS`. Once a tag exists, also verify each file's attestation as `docs/RELEASE.md` describes.

## 1. Clean-machine install

**The machine** has never had Ninerr, its source, Node.js from this project, or an earlier Ninerr package on it. A fresh user account on a computer used for other things is not enough if that computer has the development tree or an earlier package; a new virtual machine or a reset computer is. Run it on at least one platform, and preferably on all three: Windows 11 x64, macOS on Apple silicon, and Linux x64 (for example Ubuntu 24.04).

**Record first:** the operating system and version, the CPU and memory, whether it is a virtual machine, and the network the machine is on.

| Step | Do | Pass when |
| --- | --- | --- |
| 1 | Copy the archive for the platform and `SHA256SUMS` to the machine. Check the hash: `sha256sum --check --ignore-missing SHA256SUMS` on Linux, `grep Ninerr-darwin-arm64.zip SHA256SUMS \| shasum -a 256 --check` on macOS, or compare `(Get-FileHash Ninerr-win32-x64.zip).Hash` with its line in `SHA256SUMS` on Windows. | The hash matches. |
| 2 | Install it exactly as `docs/DESKTOP.md` says, including the platform's warning about an unsigned app (SmartScreen, Open Anyway, or the Linux sandbox note). Record every prompt the system showed, word for word if you can. | It installs with only the prompts `docs/DESKTOP.md` describes. |
| 3 | Start Ninerr. | The projects dialog opens. No other window, error, or request for an account, a key, or a download appears. |
| 4 | Create a project. Insert a box and a text layer, change the text, move the box, and save. | Each change shows on the canvas and in History. |
| 5 | Undo twice, then redo twice. | The canvas and History follow each step. |
| 6 | Import an HTML page that links an outside stylesheet or image (any saved web page will do). | The review names the linked resources as not fetched, and the import adds layers. |
| 7 | Open Agents, connect one agent, and run one tool call from it (for example `create_frame` through any MCP client, or `npx @modelcontextprotocol/inspector` if Node.js is on the machine). Skip this step if no MCP client is at hand, and record that. | The agent's change appears live and History names the agent. |
| 8 | Quit Ninerr, start it again and reopen the project. | Every layer and change from steps 4 to 7 is there. |
| 9 | Turn the network off (or disconnect the virtual machine's adapter). Start Ninerr, open the project, and edit and save once. | Everything works as before, with no error about the network. |
| 10 | With the network on again, watch Ninerr's connections for one minute of editing: Resource Monitor's Network tab on Windows, `nettop -p <pid>` on macOS, or `ss -tunp \| grep -i ninerr` on Linux. | It connects to nothing but `127.0.0.1` and `::1`. |
| 11 | Uninstall as `docs/DESKTOP.md` says. | The app's folder and Electron's data folder are gone. The projects folder is left as it was. |

**Afterwards**, write down anything confusing, slow, or different from `docs/DESKTOP.md`, even when every step passed. A mismatch between the documentation and what happened is a defect in one of them.

## 2. Screen-reader pass (#376)

**The setup:** NVDA with Firefox or Chrome on Windows, VoiceOver with Safari on macOS, or JAWS with Chrome on Windows, using the packaged app or local web mode (`npm run dev`, then the printed URL) at the candidate commit. Record the screen reader, its version, the browser or packaged app, and the speech verbosity settings. Use the keyboard only. The person running it should already use that screen reader, or have it set up the way its users usually do.

Each step names what to listen for. Write down what was actually said, not just whether it was right.

| Step | Do | Pass when it says |
| --- | --- | --- |
| 1 | Start Ninerr. Tab through the projects dialog, create a project named "Reader test", and confirm. | The dialog's title and each field's label. After confirming, that the project is open, either from the status line or from where focus lands. |
| 2 | Tab through the toolbar from Projects to Agents. | Each button's name, the groups (History, Layers, Pages, Zoom), and which buttons are unavailable. |
| 3 | Press Insert box, then Insert text. | That each layer was inserted. |
| 4 | Move to the Layers tree. | That it is a tree that allows more than one selection; the keyboard hint (moving with Alt and the arrows, Shift+Enter, Ctrl+G); and each layer's name, level and position as the arrows move through it. |
| 5 | On a layer, press Alt+Down, then Alt+Up. | Each move, and the layer's new position. |
| 6 | Select two layers with Shift+Enter, then press Ctrl+G. | Each layer joining the selection; then the new group, and where focus has landed. |
| 7 | Try a move that is refused, such as Alt+Left on a top-level layer, or Alt+Up on the first one. | Why it was refused, without focus moving. |
| 8 | Open the Inspector for the text layer, change its text, a style value (a color or a size) and its Classes field, and commit each. | Each field's label and value, and that the change was made. After Classes commits, where focus has landed. |
| 9 | Press Undo and Redo, by their buttons and by Ctrl+Z and Ctrl+Shift+Z. | What was undone or redone. |
| 10 | Zoom in and out with Ctrl+= and Ctrl+-. | The new zoom level. |
| 11 | Open and close Code, Tokens, Components and Agents in turn, closing each with Escape. | Each dialog's title when it opens. When it closes, focus goes back to the button that opened it. |
| 12 | Put the browser or window at 320 CSS pixels wide (zoom to 400% on a 1280-pixel window), and repeat steps 4, 6 and 8. | The same as before, with the focus ring visible on every control reached. |

**Recording:** the result is pass, pass with problems, or fail. For every problem, give the step, what was said, what should have been said, and whether it stops a screen-reader user from finishing the task. Problems are filed as issues and linked from the record. The fixes go to the Desktop and UI owner, the founder, under the 2026-11-14 decision.

## Record template

```markdown
# <Clean-machine install | Screen-reader pass> on <commit short sha>, <date>

- **Candidate commit:** <40-character sha>
- **Files:** Release Evidence run <url>, artifact `ninerr-release-<sha>`; archive sha256 <hash>
- **Run by:** <name or role>
- **Machine:** <OS and version, CPU, memory, virtual or physical>
- **Software:** <screen reader and version, browser or packaged app>

| Step | Result | What happened |
| --- | --- | --- |
| 1 | pass / fail / skipped (why) | ... |

**Outcome:** pass / pass with problems / fail. Issues: #...
```
