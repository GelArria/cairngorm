# Development and debugging

## Toolchain

Use Node.js 24/npm for the root frontend, Bun 1.3.14 for `src/agent/core`, and stable
Rust for `src-tauri`. Install the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)
for the host OS. Root `package-lock.json` supports `npm ci`; the sidecar's `bun.lock`
supports its Bun build/test jobs. Its npm lockfile is also used by the security audit
and release inventory scripts. Keep lockfiles aligned when changing dependencies.

```sh
npm ci
node scripts/build-agent.mjs
node scripts/build-cli.mjs   # Windows and macOS
npm run tauri dev
```

The Tauri dev hook initializes missing agent settings and starts Vite on port 1420.
It does not select a model or replace existing settings. `npm run tauri:resetconfig`
is an explicit reset, not a normal setup step. The sidecar build above installs its
frozen Bun dependencies and creates the binary required by Tauri, including dev builds.
On Windows and macOS the dev hook also builds the `cairngorm` terminal command
(`scripts/build-cli.mjs`), which the bundle ships.

For a frontend-only preview, use `npm run dev`. Browser tests set `E2E_TEST=1` to load
mocks; an ordinary browser preview cannot perform native operations. See
[the test guide](../tests/README.md) for test runner configuration.

## Native app safety

A running Cairngorm instance may host active shells, unsaved documents and the terminal
running your development agent. Close it only after saving work and coordinating with
its user. Do not use a blanket process-kill command to release a build lock.

Avoid running installed and development instances together against the same app data and
plugin gateway. If a build reports a locked executable/DLL, identify the owning process
and arrange a safe shutdown. If port 1420 is in use, identify its owner before stopping it.

## Debugging the frontend

Use the native webview's developer tools (F12) for Console, Network and Elements.
For browser-only debugging, start Vite directly. Native bugs involving PTYs, window
lifecycles, file permissions or application automation need the desktop app; mocks cannot
validate them.

To run the native backend separately, start `npm run dev` in one terminal, then run:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features
```

The app needs Vite listening first and the sidecar prepared by the setup command above. `RUST_LOG=debug` enables additional Rust diagnostics;
on PowerShell, set it with `$env:RUST_LOG = "debug"` before launching.

## CrabNebula DevTools

The dashboard is an opt-in debugging aid, left out of normal and release builds. Start a
debug build with it: `npm run tauri dev -- --features devtools` with `PANEL_DEVTOOLS=1` set.
It then prints a local dashboard URL, typically under
`https://devtools.crabnebula.dev/dash/127.0.0.1`. Use the URL printed by the running app;
its port is not a stable API. Open it in a normal browser, not a headless session that
may block the HTTPS-to-local-WebSocket connection.

| Tab         | Use                                           |
| ----------- | --------------------------------------------- |
| Calls       | Tauri invoke requests, responses and timing   |
| Events      | Emitted/listened events and asynchronous flow |
| Webviews    | Window state, URLs and loading errors         |
| Performance | CPU/memory observations                       |

If the dashboard cannot connect, verify the printed port is listening. Fall back to the
webview console and targeted Rust diagnostics. Keep logs local and redact credentials,
project contents and personal paths before sharing them.

## Crashes and hangs

The crash handler records Rust panics, JS errors, render failures and unhandled rejections.
The watchdog watches frontend heartbeats; a gap can indicate a blocked webview rather than
a Rust panic. Inspect JSON diagnostics before collecting a memory dump. Data locations,
retention controls and the opt-in memory-dump policy are documented in
[the security baseline](security.md#data-retention).

A dump may include arbitrary process memory and credentials. Never commit it or attach it
to a public issue without an explicit privacy review. Analyze Windows dumps with WinDbg
or Visual Studio; the accompanying hang JSON provides the frontend snapshot context.

## Build outputs

`npm run build` verifies checked-in document SDK/provider JavaScript, type-checks the
frontend and builds `dist/`. After editing SDK/provider TypeScript, regenerate with
`npm run build:document-sdk` and review the generated diff.

`npx tauri build` compiles the sidecar and produces the platform installer. See
[the scripts guide](../scripts/README.md) for CI packaging and
[macOS builds](macos-build.md) for signing. Keep build output, local notes and diagnostics
in ignored directories; tests and reusable source helpers must not depend on files in `logs/`.

Run the basic checks from the repository root:

```sh
npm run build
npm test
npm run format:check
npx tauri build
```

Local installers are written under `src-tauri/target/release/bundle/`: NSIS on Windows,
app/DMG on macOS, and DEB/RPM on Linux. CI packages AppImages separately. Windows builds
currently target x64 because the bundled ConPTY binaries are x64. An unsigned local build
is not a signed release.

## Contributing

Follow the [coding conventions](coding-conventions.md) and keep each change focused.
Include a regression test for behavior changes. Describe the user-visible change,
checks run and any unverified platforms in the PR; discuss cross-feature reorganizations
before moving files. See [architecture](architecture.md) for module ownership and
[tests](../tests/README.md) for runner-specific prerequisites and known CI limitations.

Keep local agent settings, work plans, credentials and build output out of commits.
Write diagnostics to `logs/` and screenshots to `logs/e2e/`. Ignore rules do not remove
material from existing commits: inspect the diff and history before publishing, and
redact credentials or user content before sharing logs.

ConPTY, fonts, icons and document templates are required build inputs, not temporary files.
Checked-in document SDK/provider JS must stay aligned with its TypeScript sources.

## Licensing

Cairngorm is released under the [MIT License](../LICENSE). Contributions are accepted under
the same license.

Third-party components keep their own licenses. `licenses/THIRD-PARTY-NOTICES.txt` holds the
license text of every Rust crate in `Cargo.lock` and every production npm package of the app
and the agent sidecar; the installers ship it with `LICENSE`, the bundled font's notice
(`licenses/CaskaydiaCove-Nerd-Font-OFL.txt`) and `licenses/WRY-MIT.txt`. Other assets keep
their notices beside them (file icons, provider and plugin logos, ConPTY, the patched `tao`).

After changing dependencies, commit the lockfiles and regenerate the notices:

```sh
node scripts/third-party-notices.mjs          # reads the committed lockfiles
node scripts/third-party-notices.mjs --check  # CI: fails when the file is stale
```
