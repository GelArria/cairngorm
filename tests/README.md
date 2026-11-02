# Tests

Run commands from the repository root unless a section says otherwise. Install root
dependencies with `npm ci` first. Tests cover different boundaries; a browser test with
Tauri mocks is not evidence that a native window or PTY works.

## Suites

| Location                               | Runner                 | Scope                                                         |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `unit/`                                | Vitest                 | Frontend behavior, models, contracts and repository checks    |
| `e2e/*.e2e.ts`                         | TesterArmy `e2e`       | Browser flows; default target uses mocked Tauri               |
| `e2e/*.spec.ts`                        | Playwright             | Existing browser and opt-in native/CDP regressions            |
| `e2e/native-fresh.live.ts`             | TesterArmy (opt-in)    | Fresh Windows profile, real PTY/MCP consent and workbook pane |
| `native/*.rs`                          | Cargo                  | Native tests included by their owning Rust modules            |
| `native/*.{mjs,cjs,py,ps1}`            | Per-file command       | Native probes and benchmarks; read prerequisites first        |
| `mocks/`, `fixtures/`, `e2e/fixtures/` | Imported by tests      | Test doubles and sample inputs                                |
| `manual/windows/`                      | PowerShell             | Explicit desktop clicks/screenshots; not automated assertions |
| `../src/agent/core/src/tests/`         | Bun                    | Standalone agent package tests                                |
| `../src/terminal/hooks/__tests__/`     | Separate Vitest config | Internal terminal hook tests                                  |

## Frontend unit tests

```sh
npm test
npx vitest run -c tests/vitest.terminal.config.ts
```

For a focused check, pass a path to `npx vitest run`. Root Vitest intentionally discovers
only `tests/unit`; it does not run the sidecar, native or browser suites.

## Browser flows

Prefer TesterArmy for new flows. The existing config starts Vite with mocked Tauri APIs
on a free loopback port. Deterministic tests do not need a model or paid credentials.
Install Chromium once with `npx playwright install chromium`.

```sh
npx e2e run tests/e2e/app-launch.e2e.ts
npx e2e run
```

Existing Playwright tests always need an explicit config:

```sh
npx playwright test -c tests/playwright.config.ts tests/e2e/app-menu.spec.ts
npm run test:e2e
```

`test:e2e` currently selects Playwright, not TesterArmy. The legacy full Playwright job
is informational in CI because it has known failures. The default, preview and resize
configs exclude native/CDP specs regardless of inherited opt-in environment variables.
They use a separate mocked Vite/browser, not the native app's data directory or gateway.
This selection boundary does not explain or guard against every possible app shutdown.

### Protect the app hosting your terminal

Wrap browser/native commands with the reusable process guard. It snapshots every running
Cairngorm PID and its exact Windows start time, then fails if one disappears or is replaced.
The receipt records the child command/exit status and both snapshots (not credentials).
This detects a shutdown after the run; it does not prevent arbitrary child code from doing damage.

```sh
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-reader.json -- node node_modules/e2e/dist/cli/bin.js run
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-playwright.json -- node node_modules/@playwright/test/cli.js test -c tests/playwright.config.ts --workers=1
```

`--isolated-browser` removes inherited `NODE_OPTIONS`, `CAIRNGORM_TEST_ENDPOINT`,
`CAIRNGORM_TEST_TOKEN`, `CAIRNGORM_TEST_BINARY` and `CAIRNGORM_NATIVE_PLUGIN_CHECK`
from the child only. The installed observation preload interfered with viewport/layout
checks during the audit; clearing it isolates repository tests, not a fix to that product issue.
On Unix it snapshots local processes with `ps`; it cannot see a separate Windows host.
Wrap `wsl.exe` from Windows to protect the Windows app while running Linux checks.

Windows pixel baselines in `e2e/layout-baselines.e2e.ts-snapshots/` cover app chrome/split
borders for 2x2, three stacked and after-close layouts against mocked IPC. Random gem yaw
is masked and Git status/theme/time/animations are stabilized. Inspect diffs before using
`npx e2e run tests/e2e/layout-baselines.e2e.ts --update-snapshots`; other OSes skip these
reviewed Windows baselines, not silently generate new expected images.

### Fresh native Windows profile (opt-in)

This build has a separate identifier and CDP port, never the installed app's profile.
The harness requires the QA identifier embedded in the executable and a free port 9337,
creates a unique `logs/e2e/native-fresh-*` HOME/APPDATA/LOCALAPPDATA/WebView directory,
and closes only its own child process handle. It never kills processes by name. Agent
configuration overrides (including Kimi/Kiro and case variants) are removed before launch;
`unit/fresh-profile-env.test.ts` guards this boundary.
The OS may resolve the default Home project to the actual user home; all test-created
files and client settings are explicitly addressed inside the scratch directory.

```sh
npx tauri build --debug --no-bundle --config tests/tauri.fresh-profile.json
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-native-fresh.json -- node tests/native/fresh-profile.mjs
```

The dedicated root `e2e.native-fresh.config.ts` is selected only by that harness. The test
uses a real PTY and bridge (`initialize`, `tools/list`, `cairngorm_create_file`), approves
connection and file use in the actual UI, then verifies the workbook file and provider pane.
It does not use a paid provider or an installed agent's credentials. Reports/screenshots
are under `logs/e2e/native-fresh/`; scratch directories are retained for diagnosis.

Some specs attach to a running native app over CDP instead of using the mock fixture;
select an appropriate `playwright.*.config.ts` and inspect its test match and setup first.
Never point those configs at the user's working instance. The Rust browser-storage
isolation test selects `playwright.isolation.config.ts`, supplies its own origins/CSP
and starts its own loopback server without Vite or a native app. Do not assume every
spec in `e2e/` is a standalone mocked-browser test.

The deployed-plugin check selected by `CAIRNGORM_NATIVE_PLUGIN_CHECK=1` requires its own
live setup. Native probes can create terminals, modify a test workspace, use external
services or control windows. Use an isolated test project and read the test before running it.

`native/plugin-reload-live.mjs` uses the isolated QA release profile described below and
contacts the public tldraw service without a model or personal credentials. It creates a
scratch MCP client and canvas, edits a label manually, verifies three acknowledged reloads
and a new call to the same canvas, then checks that the source PTY still responds. It closes
only its own QA child. Build that release first, then run:

```sh
CARGO_TARGET_DIR="$(pwd -W)/src-tauri/target/perf-baseline" npx tauri build --no-bundle --config tests/tauri.fresh-profile.json
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-tldraw-native.json -- node tests/native/plugin-reload-live.mjs
```

This native probe uses direct Playwright CDP attachment for the same navigation-guard
limitation documented below; deterministic browser lifecycle tests still use TesterArmy.

### Native persistence, scheduler and release handoff (Windows, opt-in)

These checks build and start a separate QA **release** executable, not an installer.
Use an absolute target directory: Tauri runs Cargo from `src-tauri`, so a relative
`CARGO_TARGET_DIR` may resolve somewhere else. For example, in Git Bash:

```sh
CARGO_TARGET_DIR="$(pwd -W)/src-tauri/target/perf-baseline" npx tauri build --no-bundle --config tests/tauri.fresh-profile.json
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-storage-lock.json -- node tests/native/storage-lock.mjs
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-scheduler-lifecycle.json -- node tests/native/scheduler-lifecycle.mjs
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-single-instance.json -- node tests/native/single-instance.mjs
```

Run them sequentially. `native/qa-profile.mjs` requires the QA identifier and a free
port 9337, verifies the native home/config path, keeps the same isolated profile across
restarts and terminates only its owned child handles. Runs have a three-minute deadline;
readiness checks, native calls, diagnostics and disconnects are also bounded so a hanging
operation reaches cleanup. `native/qa-profile-timeout.mjs` deliberately leaves a native
evaluation pending and verifies owned-child cleanup; run it with the same guard wrapper.
Logs and acceptance receipts live in unique `logs/e2e/` folders. Node with `node:sqlite`
support is required.

- `storage-lock.mjs` bundles the real frontend storage module into the native webview,
  holds a separate SQLite `BEGIN IMMEDIATE` writer lock, checks recovery copies and
  deletion timestamps, restarts the process and verifies reconciliation across a second
  restart. It also verifies a project rename during real contention, its recovery in
  SQLite and the rendered project name after restart. Unit regressions cover recovery
  of names/appearance and a failed creation followed by an edit. This does not establish
  recovery from a database-open failure during native startup.
- `scheduler-lifecycle.mjs` uses the real native timer and compiled sidecar with a local,
  deterministic OpenAI-compatible server. It verifies success, provider rejection and
  killing its own QA app mid-request, then interrupted/paused state without duplicate
  dispatch across two restarts. It does not use paid providers or personal credentials.
- `single-instance.mjs` checks release-only handoff, preserved unsaved editor content and
  unchanged authenticated gateway discovery/catalog. It does not install an update or
  prove every third-party MCP client's cache behavior.

`detached-release-native.mjs` reuses that profile for the existing three-PTY lifecycle:
real keyboard input, split inside a detached window, reattach with layout preservation,
detach again, immediate close during pending attachment, unrelated-PTY survival and no
resurrection after restart. Detached close cancels and settles pending terminal attachments
before killing its PTYs; late attachment results release listeners instead of reviving an
unmounted pane. The regression deliberately does not wait for terminal startup before the
second detach/close. It builds
its own QA release first (allow several minutes), instrumenting the bundled window-factory
configuration so secondary webviews expose the same isolated CDP port. Tracked production
configuration is unchanged; this is an instrumented QA build, not a distributable release.
Run sequentially with the other native checks, then restore ordinary frontend output:

```sh
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/e2e/guard-detached-release.json -- node tests/native/detached-release-native.mjs
npm run build
```

These native checks use direct Playwright CDP attachment because TesterArmy 0.20's
persistent-context setup navigates to `about:blank`, which the app's navigation guard
rejects. They do not weaken that guard or replace the existing TesterArmy browser suite.

### Whole-app resource baseline (Windows, opt-in)

`native/resource-baseline.mjs` measures CPU and private memory of the whole process tree
(app, WebView2 roles, consoles, shells) for startup, idle, four idle terminals, four
terminals streaming ~8 MB each and idle afterwards. It uses the fresh-profile identifier
and port 9337, builds into its own target directory so the installer binary is untouched,
and closes only its own child and that child's recorded descendants.

```sh
CARGO_TARGET_DIR=src-tauri/target/perf-baseline npx tauri build --no-bundle --config tests/tauri.fresh-profile.json
node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/perf-baseline/guard.json -- node tests/native/resource-baseline.mjs [runs]
```

Results are written to `logs/perf-baseline/<timestamp>/results.json`. One run is a sample,
not a benchmark; compare several runs before drawing conclusions from the streaming phase.

## Rust and sidecar

With Rust, Bun and the host's Tauri system libraries installed:

```sh
node scripts/build-agent.mjs
node scripts/build-cli.mjs   # Windows and macOS: the bundled cairngorm command
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features
```

### Real agents and process/window boundaries (opt-in)

`session-live.rs` runs installed CLIs in a real PTY and seeds a short conversation for
resume. It can make billable provider calls and edit each selected agent's integration
configuration; review the test and obtain permission before running it. Missing agents are
not evidence of a pass. Select agents explicitly and serialize the test:

```sh
CAIRNGORM_LIVE_AGENTS=claude,pi,opencode cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features session_resume::live_tests -- --ignored --nocapture --test-threads=1
```

Use the equivalent environment-variable syntax for your shell. Never set
`CAIRNGORM_LIVE_TRUST_CODEX=1` without the owner's explicit permission: accepting changed
Codex hooks is a trust decision, not a test repair. Droid's TUI also needs its own login.
The Windows ignored `plugin_app_script` COM tests exercise a plain script, timeout and
modal dialog; they may terminate only their disposable children. The scheduler's routine
`killing_a_runner_pauses_its_durable_claim` test kills its own runner, reopens twice and
asserts no automatic relaunch. The installed quota-relay test executes PowerShell on
Windows and Python where available, including the existing status line's stdout.

The document-window switching regression uses real Windows handles and PowerShell with
`Shell.Application`, not the user's Word/Excel instance. It checks COM window capture,
executable validation and the notification used to retarget a pane while both disposable
windows remain open:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features com_active_document_replaces -- --ignored --nocapture
```

For sidecar tests, work in `src/agent/core`:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Select offline `src/tests/*.test.ts` files when running local `bun test` checks.
**Do not run the whole sidecar suite with personal credentials without reviewing
`provider-live.test.ts`.** That file auto-enables when it finds an Ollama key in the
environment or legacy personal config and can make billable network requests. A bare
`bun test` is therefore not guaranteed offline. CI normally lacks those credentials.

## Linux install and terminal smoke

`scripts/ci/local-linux.sh` builds/tests in a WSL Linux copy, then installs bundles in
clean Docker distros. `scripts/ci/smoke-terminal.sh` focuses the native Xvfb window,
closes onboarding, opens a terminal, types a shell command, checks its scratch marker
file and OCRs a rendered output marker that is not present in the echoed command.
WebKitGTK exposes no Playwright CDP endpoint, so this native X11 input/output check uses
`xdotool`, ImageMagick and Tesseract rather than TesterArmy. Dependencies are installed
only in the disposable distro containers. Screenshots/OCR and verdicts remain under
`logs/ci-linux/<run>/smoke/`; inspect those before treating an OCR mismatch as an app bug.

## Manual tools and artifacts

`manual/windows/click.ps1` and `screenshot.ps1` target an explicit app PID. The click tool
moves the real cursor; the screenshot tool restores a minimized app window before capture.
These are manual debugging utilities, not tests. `take-all-screenshots.mjs` and
`take-screenshots.py` capture an already-running Vite preview; the Python version requires
Python and its Playwright package separately.

Keep captures under `logs/e2e/`. Runner logs and reports belong under `logs/`; local
TesterArmy caches may also live in ignored `.e2e/`. Keep reusable helpers in `tests/`,
never in ignored output directories. Redact credentials and user content before sharing
any trace, screenshot, crash file or test fixture.
