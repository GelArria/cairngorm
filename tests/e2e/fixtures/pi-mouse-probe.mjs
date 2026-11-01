// Uses Pi's installed renderer, not an imitation button. No agent/model requests.
import { pathToFileURL } from "node:url";
const { ProcessTerminal, TuiAltScreen } = await import(pathToFileURL(process.argv[2]).href);
// Match a fresh Pi CLI, rather than inheriting the recorder's already-raw console.
process.stdin.setRawMode(false);
const tui = new TuiAltScreen(new ProcessTerminal(), false, undefined, {
  scrollToEndIndicator: () => "\x1b[44m ↓ Jump to latest message · End \x1b[0m",
  copyOnSelect: false,
});
tui.addChild({
  render: () =>
    Array.from({ length: 200 }, (_, i) => `PI-TRANSCRIPT ${String(i).padStart(3, "0")}`),
  invalidate() {},
});
tui.addInputListener((data) => {
  if (data === "\x03") {
    tui.stop();
    process.exit(0);
  }
});
tui.start();
// Overflow Cairngorm's 256 KiB replay without changing the visible screen.
if (process.argv.includes("--overflow-replay")) process.stdout.write("\x1b[0m".repeat(70_000));
tui.renderNow();
tui.scrollToTop();
