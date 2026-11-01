# Feature modules

Cairngorm groups code by functionality, inspired by the feature folders in
`backend-api-route-manager/src`. Each module chooses its own internal structure.
Hexagonal layers, repository interfaces, and dependency injection are optional;
introduce them when a concrete dependency needs to vary.
Implementation conventions are documented in [coding-conventions.md](coding-conventions.md).

```text
src/
  app/                  # Startup, app layout, cross-feature coordination
    cli/                # Standalone `cairngorm` terminal command (own Cargo package)
    native/             # Tauri runtime, native window setup
  agent/
    core/               # Standalone Bun sidecar package (own dependencies/tests)
    native/             # Agent configuration, runner and native engine
  appearance/           # Theme preferences and tokens
  calendar/             # Scheduled tasks, legacy calendar UI and SQLite queries
    native/             # Durable local scheduler, task commands and sidecar dispatch
  common/
    branding/           # Shared gem/logo rendering
    components/         # Shared UI behavior (menus, resizing, keep-alive)
    events/native/      # App requests and native terminal event transport
    filesystem/native/  # File IO, dialogs, clipboard and folder context
    hooks/              # Reusable hooks
    layout/             # Sidebar orientation, section headers and workspace tab slots
    navigation/         # Navigation history
    network/native/     # Proxy and extra-certificate policy for native HTTP clients
    storage/native/     # SQLite access and migration registration
    ui/                 # shadcn primitives
  debug/
    native/             # Crash capture, watchdog and process metrics
    performance/        # Frontend instrumentation and overlay
  documents/            # Generic document panes, provider registry and TypeScript SDK
    native/             # Provider install/approval, bundle serving and bounded snapshots
    sdk/                # document-sdk.ts, generated output and the sample provider
  editor/               # Code editor and file previews
  git/native/           # Git frontend plus Rust commands
  integrations/
    assets/             # CLI integration scripts embedded by Rust
    native/             # Provider detection, verification and integration setup
  keybindings/          # Key catalog, preferences and shortcut handling
  plugins/              # MCP App plugins: view host, plugin panes and settings
    assets/             # Stdio bridge every agent CLI runs (embedded by Rust)
    native/             # Loopback gateway, catalog, upstream MCP client, agent registration,
                        # MCP server inventory and format-preserving config edits
  projects/             # Project state, persistence and actions
  search/native/        # Search state and Rust search/index implementation
  settings/             # Settings dialog (grouped sidebar) and app-level preference UI
  skills/               # Global skills manager across agent harness folders
    native/             # SKILL.md discovery, enable/disable and scaffolding
  sidebar/              # Project navigation and module panels
  terminal/
    components/         # Terminal UI
    hooks/              # Preact subscriptions and lifecycle wiring
    model/layout/       # Pure grid calculations
    data/               # Persistence, PTY transport and launch preferences
    runtime/            # xterm instances, IO scheduling, resizing and addons
    state/              # Single store and focused actions
    native/             # PTY, shell detection, replay and session reports
  testing/
    assets/             # Embedded Playwright bridge scripts
    native/             # Test observation and browser transport
src-tauri/              # Cargo crate, bundle resources and Tauri configuration
tests/                  # Frontend and native validation
logs/                   # Generated logs/screenshots; ignored by Git
```

## Frontend responsibilities

Each feature separates the responsibilities it actually needs; do not create empty
folders or a global collection of feature components:

```text
src/<feature>/
  components/           # Rendering, props, callbacks and local visual state
  hooks/                # Subscriptions, lifecycle and user-operation orchestration
  data/                 # Native access, persistence, caches and store subscriptions
  model/                # Contracts, validation and pure calculations
  native/               # Existing Rust implementation, when applicable
  <feature>-view.tsx    # Public screen/panel composition (existing names are retained)
  api.ts                # Focused cross-feature operations, when needed
```

A screen composes a behavior hook with presentation components. Effects and async
operation state do not belong in leaf renderers. Imperative rendering effects
(CodeMirror, canvas, scrolling and focus) stay beside their visual lifecycle.
Dialog and menu hooks return state and callbacks; components mount the shared
shadcn dialogs and context-menu renderer. This preserves ownership and avoids
moving state into a second instance when splitting a view.

Stores expose snapshots and subscriptions without importing Preact hooks.
For example, `projects/data/project-store.ts` owns project state while
`projects/hooks/use-projects.ts` only subscribes to it. Existing public facades
keep callers independent of implementation paths. Model/data modules do not load
components or UI primitives; hooks, data and model modules contain no JSX. These
boundaries are checked in `tests/unit/module-dependencies.test.ts`.

The standalone `agent/core` package and Rust modules retain their own internal
organization; frontend folders are not imposed on them.

## Ownership and dependencies

- `app/` composes modules. For example, `app/project-sync.ts` connects project
  changes to terminals, the active folder and Git; `projects/` owns project state.
- Cross-feature callers use focused public entry points: `projects/api.ts`,
  `projects/visuals.ts`, `calendar/api.ts`, and terminal `workspace.ts`,
  `storage.ts`, `types.ts`, or `dialogs.ts`. These exports keep state operations
  separate from renderers, so importing workspace behavior does not load its UI.
  Within a module, import the owning implementation directly.
- `app/project-actions.ts` owns the new-project flow: select a project, launch
  its terminal, and navigate. Sidebar callers dispatch the shared request from
  `common/events/app-events.ts`; they do not import app implementation.
- `app/project-sync.ts` supplies project recovery and lifecycle callbacks.
  Projects do not read terminal storage or query calendar tables. Calendar
  owns event adoption and cleanup; its queries and additions receive an explicit
  project ID. Pending calendar results cannot populate a different project view.
- `plugins/` owns MCP App views. Its gateway serves agent bridges and views on
  loopback; terminals record their root process so a bridge is matched to the
  terminal that launched its agent. Upstream MCP sessions and browser storage origins
  are isolated by plugin and source terminal. Views use scoped loopback-only localhost
  hosts; the gateway rejects a view loaded under another scope's host. Switching projects
  keeps each terminal's plugin state separate without replaying its tool input.
  Plugin panes are terminal tabs (`kind: "plugin"`)
  that, like Tests views, are never persisted. The first plugin asks permission to add
  one shared MCP bridge to installed, supported CLI configurations, preserving existing
  entries and keeping backups. Consent persists independently of enabled plugins;
  existing installs can use Settings ▸ Plugins ▸ Connect agents without re-adding plugins.
  Check agent connections registers newly installed CLIs on explicit request, never on
  startup (so manually removed connections stay removed). Pi uses its native `mcp.json`
  or an existing `mcp-adapter.json` and respects `PI_CODING_AGENT_DIR`. Pi registration
  defaults the bridge to directly declared tools (`exposure: "direct"` natively,
  `directTools: true` with adapter `lifecycle: "keep-alive"`) so visual plugins are not
  hidden behind a generic discovery proxy. Explicit checks add missing defaults to an
  owned bridge, preserving user choices, comments and backups; existing sessions need
  `/reload`. Direct visibility improves discovery, but tool selection is still the model's
  decision. The same gateway serves Pi, OpenCode and all other clients. Other MCP clients
  exposes a standard stdio entry, without the gateway secret, for clients outside the
  registration catalog.
  Connect another MCP client stores a name, existing absolute configuration path and one
  of the supported JSON/JSONC or TOML layouts in private `plugins/clients.json`. Registering
  is read-only; its switch adds only the owned `cairngorm` entry (with an opaque client id),
  keeps a backup, and preserves other servers, comments and byte-order marks. Disconnect
  and removal never delete a foreign entry. This is optional Cairngorm-side metadata, not
  a manifest or extension the CLI must implement. Unknown clients also appear automatically
  after connecting the standard bridge and identifying themselves via MCP `clientInfo`.
  A saved registration is not a live connection: a successful `initialize` followed by
  `tools/list` from the same bridge and a live Cairngorm terminal verifies it. Bridge PID
  and process-start checks exclude closed/replaced processes, including reused PIDs. Settings
  reports Restart required before verification, Connected for recent verified contacts,
  and Configured with the last contact time after ten minutes. Catalog read means only that
  the client fetched the current tools; it does not prove that the client exposed them to
  its model. Clients must declare the tools directly or make tool discovery available.
  Disabled entries and per-client errors are never shown connected. External terminals
  receive no plugin tools or enabled-plugin context.
  The bridge advertises MCP `tools.listChanged`, checks authenticated loopback catalog
  metadata every five seconds, and emits `notifications/tools/list_changed` after plugin
  or connection changes. Only a real client `tools/list` marks that session's catalog
  synced; clients that ignore notifications show Refresh required with reload guidance.
  Gateway epochs and replayed handshakes recover across app restarts. No upstream tool
  calls are made just to check the revision, and no background list fabricates verification.
  `plugin_context.rs` derives capability guidance from that same enabled catalog for every
  MCP client, without brand-specific prompt logic. The handshake names enabled plugins;
  each tool description carries its plugin's purpose, including the existing automatic-panel
  hint only for visual tools. `cairngorm://plugins` is a standard, read-on-demand MCP resource
  with current enabled capabilities, purposes, tool prefixes and the same scoped guidance.
  Its identity is stable (no subscriptions or resource-list-change capability); reads never
  initialize upstreams, execute tools, or expose their URLs or credentials. `tools/list`
  remains authoritative for callable tools when a selected service is offline or needs sign-in.
  Tool-list notifications refresh tool descriptions; resource content is fresh on each read.
  No skills, project instruction files, terminal-input interception, or second model are involved.
  User requests for files and client permissions take precedence over the plugin preference.
- `config/` owns `cairngorm.json`, the single user settings file (see
  [settings-file.md](settings-file.md)). Its entry `@/config` stays free of UI so any feature can
  read settings; permissions are never read from it.
- `documents/` owns document panes. Every file a provider declares opens in one generic
  `DocumentPane`; explorer, picker, drop, paste and restored panes route through
  `documents/api.ts` (`hasDocumentProvider`), never through format lists. The pane is the
  session owner: it resolves the provider (explicit pane choice, then the remembered choice,
  otherwise it asks), reads a bounded snapshot (`document_read_snapshot`, limit checked before
  reading) and versions it by SHA-256; late reads after a switch or close are ignored.
  Built-in providers (DOCX, spreadsheet, PDF) render in-process through the same
  `DocumentViewProps` contract. Installed providers are approved web bundles
  (`cairngorm-provider.json`, see [document-providers.md](document-providers.md)) copied into
  `document-providers/` in app data and listed in `approved.json` with a hash of every file
  (the approval token shown at review; changed folders stop loading). Providers cannot claim
  extensions Cairngorm edits as text or code. Bundled providers (the XLSX spreadsheet
  editor in `documents/providers/spreadsheet/`) are embedded by `document_bundled.rs` and
  installed through the same review path when the user adds them.
  The plugin gateway serves a relay frame on `d-<hash(provider, project)>.localhost` whose CSP
  embeds only the sibling `v-<hash>.localhost` provider origin (blocking navigation-based
  exfiltration), and serves the bundle on that `v-` host with a
  same-origin-only CSP and a guard script that removes WebRTC before provider code runs;
  invokes from those origins are rejected like plugin views. The pane
  talks to them over postMessage (`document/initialize`, `document/read`, `document/ready`,
  `document/error`, `document/changed`, `host/context-changed`, `document/teardown`), checking
  source window, origin and handshake. The SDK is TypeScript (`documents/sdk/document-sdk.ts`)
  compiled by `scripts/build-document-sdk.mjs` into `documents/sdk/generated/`, which Rust
  embeds. Providers declaring "edit" hand bytes back on save; `document_save` (raw IPC body)
  checks the opened version, keeps a backup in app data, writes a sibling temporary file and
  renames it over the original, leaving the original untouched on conflict or sharing errors.
  Installed applications are driven through their own automation API, never through
  per-feature adapters. Discovery has two generic drivers: `com` (`plugin_app_discovery.rs`
  finds every registered COM automation server, `<Name>.Application` outside the Windows
  folder; `cairngorm_app_script` runs a PowerShell script with `$app` bound to it,
  `plugin_app_script.rs`; 120 s, project folder, hidden instances it started are closed) and
  `mcp` (catalog entries name the application's own stdio MCP server, e.g. `"mcp":
"photocraft-cli mcp"`; `plugin_app_mcp.rs` finds the program on PATH or in the install
  folders, `cairngorm_app_tools`/`cairngorm_app_call` talk to it through one process per
  terminal and application (`plugin_app_mcp_sessions.rs`), ended with the terminal or Cairngorm;
  `plugin_app_mcp_session.rs` writes and reads on its own threads, so every request is bounded
  by its timeout and a server that times out or sends unreadable output is replaced). Settings ▸ Plugins derives each local application's state from the same
  discovery (catalog id = discovered id, or the id after a vendor prefix such as `microsoft-`):
  Ready, No automation, or Not found; there is nothing to add. After a successful script or call,
  the application's window is docked in a pane beside the terminal. On Windows, the COM
  wrapper captures that instance's `ActiveWindow.Hwnd` (or `Hwnd`) before releasing it,
  separately from stdout. Rust validates the handle against the installed executable and
  sends that exact window to the existing pane; applications without either property retain
  the largest-window fallback. Switching documents releases the previous docking lease
  before attaching the next window, without saving or closing either document. App panes
  stay mounted when another project is selected: the hidden pane keeps its docking lease
  and hides the native window instead of restoring it to the desktop. Selecting the original
  project's app tab shows the same window again; explicitly released standalone windows
  remain outside this lifecycle.
  Each application has its own first-use consent subject (`app:<id>`, "Always" stored per project as `app_grants`).
  No request waits blindly. Agents may pass `timeoutSeconds` (5–600, default 120). While a COM
  script runs, `plugin_app_watch.rs` observes the application's windows once a second (read-only:
  nothing is clicked or closed) and stops the script with a code in `stopped`: `app-dialog`
  (a modal dialog for 4 s; its title, text and buttons go to the agent), `app-not-responding`
  (hung for 10 s), `timed-out` or `cancelled`. A stopped application is probed with a trivial
  request before the next script (`plugin_app_busy.rs`), which answers `app-busy` instead of
  queueing behind a call that never returned. Requests are cancelled by MCP
  `notifications/cancelled` or when the client connection closes (`plugin_app_cancel.rs`; the
  bridge aborts its requests when its agent exits). The MCP driver reports the same
  `timed-out`/`cancelled` codes plus `app-stopped`/`app-failed`, and forwards cancellations to
  the application's server. Dialog and hang observation is Windows-only for now.
  Platforms: every script runs through `plugin_app_run.rs` (own process tree, bounded output,
  the same watch and stop codes). Windows uses the `com` driver; macOS uses `osa`
  (`plugin_app_osa.rs`): every `.app` in the Applications folders whose Info.plist declares
  `NSAppleScriptEnabled` or `OSAScriptingDefinition` is listed (id from the bundle identifier),
  and scripts run as JavaScript for Automation (`osascript -l JavaScript`) with `app`,
  `started` and `print`. Linux has no common automation interface: only applications with
  their own MCP server are driven there. Windows docks application windows into panes; on
  macOS and Linux nothing is docked and applications show their own windows as usual. The
  script gets what is left of the request's limit after approval, the busy check and waiting
  for its turn. macOS builds declare `NSAppleEventsUsageDescription` (`src-tauri/Info.plist`)
  and the `com.apple.security.automation.apple-events` entitlement (`Entitlements.plist`).
  Known gap: on macOS an application a stopped script launched is left running (Windows ends
  instances it started that show no window).
  File tools are offered once agents are connected; the first call from each terminal session
  asks the user (`plugins/native/plugin_file_consent.rs`) unless File access is set to Always,
  and Off removes them.
  Agents use `cairngorm_create_file` (a provider's `template` copied into a new file inside
  the project, never overwriting, then opened), `cairngorm_open_file` (authorized like reads, snapshot kept as an immutable
  ticket, opened in the caller terminal's project and acknowledged before the tool returns) and
  `cairngorm_document_operation` (runs a provider-declared operation in that pane; saving is
  refused while the user has unsaved changes there).
  A document tab can move into its own window (`detached-doc-<tab>`, by dragging the tab out
  or the pane's Open in new window button; never with unsaved edits). The tab stays in main
  as detached, so closing the window (confirming unsaved edits) or restarting brings it back.
  Only `main` and `detached-doc-*` windows may save or read agent snapshots; main forwards
  agent operations for a moved document to its window.
- Settings ▸ MCP servers reads every installed agent CLI config (user scope plus the
  active project). Credentials in commands and URLs are masked in Rust before they
  reach the webview; edits re-parse the file and refuse anything but the intended change.
- Skills are disabled by renaming `SKILL.md` to `SKILL.md.disabled`; linked folders
  (symlinks, junctions) are listed once under their target.
- Put code in `common/` when several features use it and it has no feature owner.
  Git and search share `common/filesystem/workspace-root.ts`, so neither needs
  to load the other's implementation to read the active folder.
- Keep subscriptions and effects outside pure calculations. Terminal actions
  use one state store; layout helpers only transform cells and layouts.
- The terminal hook preserves its existing exports for compatibility. Internal
  files import the focused state/action implementation instead of the hook.
- Split large files at an actual responsibility. Aim for about 200 lines while
  preserving cohesive algorithms; existing large renderers and agent-loop files
  can be decomposed independently of the directory layout.

## Agent session restore

Each terminal exports `CAIRNGORM_SESSION_REPORT`. Integrations write the agent's
conversation reference there and `terminal/native/session_report.rs` reopens it on
restart. A catalog/profile selection is an initial launch, not a permanent identity:
the latest reported CLI, conversation and mode take precedence over its historical
launch command. Old prompts, model overrides and permission flags are not replayed.
Only recognized Cairngorm wrappers are replaced; arbitrary explicit user scripts
remain unchanged.

- Pi and OpenCode report through their own extension/plugin.
- Claude, Droid, Gemini, Qwen and Copilot use a `SessionStart` hook in `settings.json`;
  Cursor uses `hooks.json`, Grok its own `hooks/cairngorm.json`, Codex `hooks.json`
  (Codex asks the user to trust it with `/hooks`). Only existing config folders change.
- Agents import each other's hooks, so the shared script reports the CLI that launched
  it (through shells only), using the configured name only as a fallback.
- `terminal/native/session_resume.rs` owns each agent's resume command and the launch
  state carried over: Claude and Grok permission modes (tracked on every prompt), Codex
  bypass, Cursor `--force`/`--mode`/`--sandbox`, Gemini/Qwen `--yolo`/`--approval-mode`
  and Pi's restrictive tool flags. Pi and OpenCode restore model and agent from their own
  session. Unknown flags or values are dropped; historical profile flags do not override
  the current report.
- `terminal/native/launch_permissions.rs` reads each final launch command; `pty_ensure`
  returns `permissionsOff` and the tab shows a shield when approvals are skipped.
- `integrations/native/agent_cleanup.rs` removes the hooks, session plugins and status
  line relay; `plugins/native/plugin_disconnect.rs` removes MCP bridge entries.
  `app/native/agent_config_cleanup.rs` coordinates both for Settings ▸ Plugins and for
  the Windows uninstaller with "Delete app data" checked (`--remove-agent-integrations`, from
  `src-tauri/windows/installer-hooks.nsh`). A marker in `~/.panel/agent` stops hooks
  from being added back until the user restores them.
- Background mode: PTYs live in the native process, not the webview, so closing main
  first asks `pty_busy_count` how many terminals run a sidecar agent or any program other
  than their shell. If any do (and `app.keepRunning` is not false), `app/background.ts`
  asks `app/native/background.rs` to hide every window and show a tray icon. On Linux,
  which has no tray here, the windows are minimized. Storage is flushed, but nothing is
  destroyed. Agents keep running and the windows reattach live on return (tray click,
  macOS Dock, or a second launch through the release-only single-instance plugin).
  The watchdog pauses while the app is hidden, so a suspended page cannot end the agents.
  Focus returning to main ends background mode, however main was reached.
  The tray's Quit emits `app-quit-requested` and main runs the normal close below. If main
  does not acknowledge the quit within five seconds, the native side snapshots the sessions
  and stops the terminals itself.
- Before a normal main-window close, app asks `pty_snapshot_sessions` to capture the live
  process tree while PTYs still exist. `terminal/native/session_snapshot.rs` keeps an open
  outer agent's report and writes a `shell` marker when the agent has exited. Nested or
  headless agents cannot keep an exited interactive agent alive. Unknown live programs are
  recorded separately, not mistaken for confirmed shells: unsupported/custom profiles retain
  their initial launch behavior, without reusing a foreign conversation report. They do not
  gain conversation resume without their own integration. A missing/mismatched reference
  for an open supported agent fails the close guard rather than saving a foreign conversation;
  malformed old metadata does not block saving a confirmed shell. This one-shot capture does
  not poll during terminal IO; an abrupt process termination can only recover the last report,
  not a final shell/agent exit observation.

## Scheduled tasks

Calendar opens its Scheduled tasks section first. Schedule event opens the
app-owned configuration dialog, which survives sidebar reparenting and receives
project options explicitly. Calendar events remain available separately; legacy
rows are never converted into executable prompts.

The native scheduler owns `scheduled-tasks.json` in the application data folder.
An OS file lock prevents two app instances dispatching the same tasks. It claims
and persists one due task before launching a fresh agent session, keeps API keys
in Rust, and records the agent's final outcome rather than dispatch success.
Tasks use an explicit saved project folder and the selected engine's current
model configuration. No shell command is constructed from task instructions.
For Git projects, `calendar/native/run_changes.rs` compares the working tree before and
after a run and saves the changed paths with its result.

Automatic agent execution is currently enabled on Windows only. Other platforms
fail closed with a visible availability message until normal/abnormal app-exit
ownership of Unix process trees is implemented and verified; their legacy event
calendar and project cleanup remain available.

Scheduling runs only while Cairngorm is open: one-time timestamps or intervals
of at least one minute, one run at a time, with a 30-minute run limit. Missed
occurrences coalesce into one; interrupted runs are paused on restart and never
silently retried. App-owned project deletion removes its pending schedules and
refuses deletion while a scheduled run is active. Only the last result is kept.

## Compilation and development

`index.html` loads `src/app/main.tsx`. The frontend TypeScript project excludes
`src/agent/core`, which has its own Bun/TypeScript configuration. Tailwind scans
frontend modules and excludes that sidecar package.

`src-tauri/src/lib.rs` attaches Rust modules with compile-time `#[path]` entries.
The Rust crate and its dependencies remain in `src-tauri`; moving a source file
adds no runtime dispatch or IPC hop. Tauri command names remain stable.

Tauri watches the relocated native and embedded-asset folders via
`build.additionalWatchFolders`. Vite ignores native sources and the sidecar
package. UI edits use Vite's normal reload path. The calendar retains its lazy
import, while terminal snapshots, debounce intervals and event batching retain
their existing behavior.

The production build compiles the agent in `src/agent/core` and writes its binary
to `src-tauri/binaries/cairngorm-agent-<target triple>` (`scripts/build-agent.mjs`).
Platform bundle settings live in `src-tauri/tauri.{windows,macos,linux}.conf.json`:
Windows ships the agent and ConPTY as resources, while macOS and Linux install the
agent as an `externalBin` beside the app executable. Development runner discovery searches the same package
for `dist/cli.js` or `src/cli.ts`, alongside the existing binary candidates.

For macOS build entry points and signing, see [macOS builds](macos-build.md).
The GitHub `Build` workflow runs manually or on version tags. Separate Linux CI
and configured Codemagic jobs also build installers on ordinary pushes; see
[build and CI scripts](../scripts/README.md).

## Verification

Run from the repository root:

```sh
npm run build
npx vitest run
npx vitest run -c tests/vitest.terminal.config.ts
npx e2e run
npx playwright test -c tests/playwright.config.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features
```

Run the sidecar's `bun run check`, `bun run build`, and `bun test` from
`src/agent/core`. Its `provider-live` tests call a configured external provider;
select the other test files when doing local structural validation.

Frontend tests belong in `tests/unit/` or `tests/e2e/`, including the calendar
tests. Sidecar and terminal internal tests remain inside their respective
packages. Rust test files remain in `tests/native/` and are included by their
owning implementation. Write all generated artifacts below `logs/`.
