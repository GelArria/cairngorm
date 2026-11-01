# Microsoft ConPTY runtime (Windows x64)

Pinned package: [Microsoft.Windows.Console.ConPTY 1.24.260710001](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY/1.24.260710001), MIT license (included).

Files are unmodified, Microsoft-signed binaries from the official NuGet package:

| File | Package path | SHA-256 |
| --- | --- | --- |
| `conpty.dll` | `runtimes/win-x64/native/conpty.dll` | `39fba2713e2495117b1591ae8c32a3b904bea7aa66069cf7815e2844c76d75d8` |
| `OpenConsole.exe` | `build/native/runtimes/x64/OpenConsole.exe` | `b7fd936c2668b87b9ecf7b3366dc6568afc1c6f981874cba3e955a1c35cf8160` |

The inbox console host can swallow mouse-mode requests sent before a child enables VT input. This runtime forwards them, including Pi's fullscreen mouse handshake. `portable-pty` already loads `conpty.dll` beside its executable; no Rust fork or invented passthrough flag is required.

`build.rs` copies the pair beside development/test executables; Tauri resources install it beside the Windows application. Keep both files from the same package together when updating. Windows targets other than x64 require matching binaries and resource mappings.

Regression: `cargo test --lib fresh_pi_mouse_modes_reach_the_frontend -- --ignored` in `src-tauri`, then `npx playwright test -c tests/playwright.terminal.config.ts` with the native app running. The Pi test requires its installed TUI module (or `PI_TUI_TEST_MODULE`).
