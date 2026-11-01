import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachPty, type PtyHandle } from "../../src/terminal/data/pty-manager";
import { mountTerminal } from "../../src/terminal/runtime/terminal-runtime";
import { cancelPendingTerminalAttachments } from "../../src/terminal/runtime/terminal-attachment";
import { createTerminalSurface } from "../../src/terminal/runtime/terminal-surface";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "C:/repo") }));
vi.mock("../../src/terminal/data/pty-manager", () => ({ attachPty: vi.fn() }));
vi.mock("../../src/terminal/runtime/terminal-surface", () => ({ createTerminalSurface: vi.fn() }));
vi.mock("../../src/terminal/runtime/terminal-webgl", () => ({
  createTerminalWebgl: () => ({ schedule: vi.fn(), dispose: vi.fn() }),
}));
vi.mock("../../src/terminal/data/scrollback-store", () => ({
  SCROLLBACK_LIMIT: 100000,
  loadScrollback: vi.fn(async () => undefined),
  saveScrollback: vi.fn(),
  clearScrollback: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  { isAgent: false, closeWhileAttaching: false },
  { isAgent: true, closeWhileAttaching: false },
  { isAgent: false, closeWhileAttaching: true },
  { isAgent: true, closeWhileAttaching: true },
])(
  "handles startup replies and pending disposal (agent: $isAgent, closing: $closeWhileAttaching)",
  async ({ isAgent, closeWhileAttaching }) => {
    // Background windows can receive PTY output before their first animation frame.
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const term = new Terminal({ allowProposedApi: true });
    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);
    vi.mocked(createTerminalSurface).mockReturnValue({
      term,
      fitAddon,
      serializeAddon,
      mouseEncoding: () => "",
      disposePreferences: vi.fn(),
    });

    let onData: ((data: Uint8Array, replay?: boolean) => void) | undefined;
    const write = vi.fn(async (_data: string) => {});
    const pty: PtyHandle = {
      write,
      resize: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      detach: vi.fn(),
      onExit: vi.fn(),
      onData: (listener) => {
        onData = listener;
      },
      flushReplay: () => {
        onData?.(
          new TextEncoder().encode(isAgent ? "\x1b[2J\x1b[H" : "\x1b[c\x1b[>c\x1b[6n\x1b[2J\x1b[H"),
          false,
        );
        return true;
      },
    };
    let finishAttach!: (handle: PtyHandle) => void;
    vi.mocked(attachPty).mockImplementation(() =>
      closeWhileAttaching
        ? new Promise((resolve) => {
            finishAttach = resolve;
          })
        : Promise.resolve(pty),
    );
    const ptyRef = { current: null as PtyHandle | null };
    const onReady = vi.fn();
    const cleanup = mountTerminal({
      termRef: { current: document.createElement("div") },
      xtermRef: { current: null },
      ptyRef,
      activeRef: { current: false },
      sessionId: "startup-replies",
      shellPath: "sh",
      isAgent,
      onReady,
    });

    try {
      if (closeWhileAttaching) {
        await vi.waitFor(() => expect(attachPty).toHaveBeenCalledOnce());
        const draining = cancelPendingTerminalAttachments();
        let drained = false;
        void draining.then(() => {
          drained = true;
        });
        cleanup?.();
        await Promise.resolve();
        expect(drained).toBe(false);
        finishAttach(pty);
        await draining;
        await vi.waitFor(() => expect(pty.detach).toHaveBeenCalledOnce());
        expect(ptyRef.current).toBeNull();
        expect(pty.onExit).not.toHaveBeenCalled();
        expect(onReady).not.toHaveBeenCalled();
        return;
      }
      await vi.waitFor(() => expect(pty.onExit).toHaveBeenCalledOnce());
      await new Promise<void>((resolve) => term.write("", resolve));
      expect(write.mock.calls.map(([data]) => data)).toEqual(
        isAgent ? [] : ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[1;1R"],
      );
      expect(onReady).not.toHaveBeenCalled();
      onData?.(new TextEncoder().encode("startup prompt\r\n"));
      await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
      onData?.(new TextEncoder().encode("more output\r\n"));
      await new Promise<void>((resolve) => term.write("", resolve));
      expect(onReady).toHaveBeenCalledOnce();
    } finally {
      cleanup?.();
      term.dispose();
    }
  },
);
