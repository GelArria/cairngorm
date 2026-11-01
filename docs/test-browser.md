# Test browsers

The **App** view follows actual Playwright pages from the source terminal. Tabs
identify Chromium, Firefox and WebKit, including the Playwright project name.
Select a tab to inspect that page, or use **Follow tests** to follow the newest
active page. The final image remains available after the test closes its browser.
**Pause** keeps the selected image even if the runner opens another page;
**Resume** returns to the current live page. Test execution continues while paused.

The **Browser** view opens an independent, interactive preview. Enter a local
address such as `localhost:3000`, press **Go**, and use Back, Forward and Reload.
This preview has its own session; it does not navigate or modify the runner's
browser. **Live tests** returns to the actual test pages.
Starting tests preserves an already opened manual preview, including its page,
fields and navigation history. Browser previews also work in detached windows.

Before running tests, right-click a terminal or its tab and choose **Open test
browser**. That opens the preview without starting a test run or a second shell.

## Runtime and license

The desktop preview uses [WRY](https://github.com/tauri-apps/wry) through Tauri's
existing runtime, under the [MIT license](../licenses/WRY-MIT.txt). It uses
WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux. No additional
engine binary or Electron dependency is included. Tauri's `unstable` feature
enables the child webview API. Desktop previews are created on demand and closed
when the Browser view unmounts; resizing, hidden panels and open menus/dialogs
update their native bounds or visibility.

Live observation uses the browser installed for the project by Playwright;
Chromium, Firefox and WebKit keep their original test behavior. Run tests from a
Cairngorm terminal to inherit the bundled observer. Tests that never open a
browser continue to display results and output.

The Browser preview accepts HTTP/HTTPS addresses and rejects embedded credentials
and privileged schemes. It blocks additional popup windows. The web version of
Cairngorm keeps live streaming available and identifies desktop-only navigation.

## Verification

- `npx vitest run`
- `npx playwright test -c tests/playwright.config.ts tests/e2e/test-browser.spec.ts tests/e2e/visual-testing.spec.ts`
- With native Cairngorm running: `npx playwright test -c tests/playwright.browser-native.config.ts`

Screenshots and results are written under `logs/e2e/`.
