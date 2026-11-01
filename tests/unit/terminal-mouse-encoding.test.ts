import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";
import { trackMouseEncoding } from "../../src/terminal/runtime/mouse-encoding";

const write = (term: Terminal, text: string) =>
  new Promise<void>((resolve) => term.write(text, resolve));

it.each([1006, 1016])(
  "preserves mouse encoding %s across real serialization and restore",
  async (mode) => {
    const original = new Terminal({ allowProposedApi: true });
    const restored = new Terminal({ allowProposedApi: true });
    try {
      const addon = new SerializeAddon();
      original.loadAddon(addon);
      const encoding = trackMouseEncoding(original);
      await write(original, `\x1b[?1000h\x1b[?${mode}h`);
      await write(restored, addon.serialize() + encoding());
      expect(restored.modes.mouseTrackingMode).toBe("vt200");
      let report = "";
      restored.onData((data) => {
        report += data;
      });
      await write(restored, `\x1b[?${mode}$p`);
      expect(report).toBe(`\x1b[?${mode};1$y`); // DECRQM: restored encoding is set
      await write(original, `\x1b[?${mode}l`);
      expect(encoding()).toBe("");
      await write(original, `\x1b[?${mode}h\x1bc`);
      expect(encoding()).toBe("");
    } finally {
      original.dispose();
      restored.dispose();
    }
  },
);
