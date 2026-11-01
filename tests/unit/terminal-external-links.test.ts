import { beforeEach, expect, it, vi } from "vitest";
import { createTerminalSurface } from "@/terminal/runtime/terminal-surface";
import type { ITerminalOptions } from "@xterm/xterm";

type Activate = (event: MouseEvent, address: string) => void;
const links = vi.hoisted(() => ({
  open: vi.fn(async (_address: string) => undefined),
  activate: undefined as Activate | undefined,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: links.open }));
vi.mock("@/appearance/data/store", () => ({ subscribeAppearance: () => () => {} }));
vi.mock("@/appearance/data/transparency", () => ({
  getTransparency: () => ({ enabled: false }),
  subscribeTransparency: () => () => {},
}));
vi.mock("@/appearance/model/terminal-theme", () => ({ terminalTheme: () => ({}) }));
vi.mock("@/terminal/data/font-zoom", () => ({ getFontSize: () => 14 }));
vi.mock("@/terminal/data/terminal-preferences", () => ({
  getTerminalPreferences: () => ({ scrollback: 1000 }),
  subscribeTerminalPreferences: () => () => {},
}));
vi.mock("@/terminal/runtime/clipboard-keys", () => ({ attachClipboardKeys: () => {} }));
vi.mock("@/terminal/runtime/mouse-encoding", () => ({ trackMouseEncoding: () => ({}) }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    unicode = { activeVersion: "" };
    constructor(public options: ITerminalOptions) {}
    loadAddon() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor(activate?: Activate) {
      links.activate = activate;
    }
  },
}));

beforeEach(() => {
  links.open.mockClear();
});

it("opens detected web addresses in the system browser, never window.open", async () => {
  const popup = vi.spyOn(window, "open").mockReturnValue(null);
  const surface = createTerminalSurface();
  try {
    expect(links.activate).toBeTypeOf("function");
    const event = new MouseEvent("click", { cancelable: true });
    links.activate!(event, "https://example.com/agent");
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(links.open).toHaveBeenCalledWith("https://example.com/agent");
    expect(popup).not.toHaveBeenCalled();
  } finally {
    surface.disposePreferences();
    popup.mockRestore();
  }
});

it("confirms the actual OSC 8 destination before opening it in the system browser", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const surface = createTerminalSurface();
  try {
    const activate = surface.term.options.linkHandler?.activate;
    expect(activate).toBeTypeOf("function");
    activate!(new MouseEvent("click"), "https://example.com/osc8", {
      start: { x: 1, y: 1 },
      end: { x: 5, y: 1 },
    });
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("https://example.com/osc8"));
    expect(links.open).toHaveBeenCalledWith("https://example.com/osc8");
  } finally {
    surface.disposePreferences();
    confirm.mockRestore();
  }
});

it("does not open an OSC 8 destination when confirmation is cancelled", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const surface = createTerminalSurface();
  try {
    const event = new MouseEvent("click", { cancelable: true });
    surface.term.options.linkHandler!.activate(event, "https://example.com/hidden", {
      start: { x: 1, y: 1 },
      end: { x: 5, y: 1 },
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("https://example.com/hidden"));
    expect(event.defaultPrevented).toBe(true);
    expect(links.open).not.toHaveBeenCalled();
  } finally {
    surface.disposePreferences();
    confirm.mockRestore();
  }
});
