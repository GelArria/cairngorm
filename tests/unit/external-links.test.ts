import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateExternalWebLink, installExternalLinks } from "@/common/navigation/external-links";

const shell = vi.hoisted(() => ({ open: vi.fn(async (_address: string) => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => shell);
let uninstall: (() => void) | undefined;

beforeEach(() => shell.open.mockClear());
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.replaceChildren();
});

it.each(["", "_blank", "_top"])(
  "routes external anchors (%s) without navigating the app",
  async (target) => {
    uninstall = installExternalLinks();
    const anchor = document.createElement("a");
    anchor.href = "https://example.com/document#section";
    anchor.target = target;
    const text = anchor.appendChild(document.createElement("span"));
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    text.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(shell.open).toHaveBeenCalledWith("https://example.com/document#section");
  },
);

it("routes middle clicks once and leaves internal anchors alone", async () => {
  uninstall = installExternalLinks();
  const anchor = document.body.appendChild(document.createElement("a"));
  anchor.href = "https://example.com/";
  anchor.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
  await Promise.resolve();
  expect(shell.open).toHaveBeenCalledTimes(1);
  anchor.href = `${window.location.origin}/#internal`;
  const internal = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(internal);
  expect(internal.defaultPrevented).toBe(false);
  expect(shell.open).toHaveBeenCalledTimes(1);
});

it.each([
  "javascript:alert(1)",
  "file:///C:/secret",
  "file://server/share/secret",
  "javascript://example.com/%0Aalert(1)",
  "data://example.com/text/html,test",
  "ms-settings://privacy",
  "ftp://example.com/file",
  "data:text/html,test",
  "ms-settings:privacy",
  "https://user:password@example.com/",
  "invalid URL",
  `https://example.com/${"x".repeat(8192)}`,
  `https://example.com/${"é".repeat(2000)}`,
])("does not hand unsafe links to the operating system: %.40s", (address) => {
  const event = new MouseEvent("click", { cancelable: true });
  activateExternalWebLink(event, address);
  expect(event.defaultPrevented).toBe(true);
  expect(shell.open).not.toHaveBeenCalled();
});

it("respects consumed clicks and removes both listeners on teardown", () => {
  uninstall = installExternalLinks();
  const anchor = document.body.appendChild(document.createElement("a"));
  anchor.href = "https://example.com/";
  const consumed = new MouseEvent("click", { bubbles: true, cancelable: true });
  consumed.preventDefault();
  anchor.dispatchEvent(consumed);
  anchor.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));
  expect(shell.open).not.toHaveBeenCalled();
  uninstall();
  uninstall = undefined;
  // Non-cancelable synthetic events avoid asking jsdom to navigate after teardown.
  anchor.removeAttribute("href");
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  anchor.dispatchEvent(new MouseEvent("auxclick", { bubbles: true }));
  expect(shell.open).not.toHaveBeenCalled();
});

it("reports opener failures without an unhandled rejection or webview fallback", async () => {
  const error = new Error("Browser unavailable");
  shell.open.mockRejectedValueOnce(error);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const popup = vi.spyOn(window, "open").mockReturnValue(null);
  try {
    activateExternalWebLink(new MouseEvent("click"), "https://example.com/");
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith("[links] Could not open browser", error);
    expect(popup).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    popup.mockRestore();
  }
});
