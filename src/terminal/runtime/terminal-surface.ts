import { subscribeAppearance } from "@/appearance/data/store";
import { getTransparency, subscribeTransparency } from "@/appearance/data/transparency";
import { terminalTheme } from "@/appearance/model/terminal-theme";
import { activateExternalWebLink } from "@/common/navigation/external-links";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { getFontSize } from "../data/font-zoom";
import { getTerminalPreferences, subscribeTerminalPreferences } from "../data/terminal-preferences";
import { attachClipboardKeys } from "./clipboard-keys";
import { trackMouseEncoding } from "./mouse-encoding";

export function createTerminalSurface() {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: getFontSize(),
    fontFamily: "'CaskaydiaCove NFM','Cascadia Code','JetBrains Mono','Consolas',monospace",
    theme: terminalTheme(),
    allowProposedApi: true,
    linkHandler: {
      activate: (event, address) => {
        event.preventDefault();
        // OSC 8 labels can hide a different destination; retain xterm's confirmation.
        if (
          window.confirm(
            `Do you want to navigate to ${address}?\n\nWARNING: This link could potentially be dangerous`,
          )
        ) {
          activateExternalWebLink(event, address);
        }
      },
    },
    // Only while window transparency is on: it changes how WebGL rasterizes glyphs.
    allowTransparency: getTransparency().enabled,
    scrollback: getTerminalPreferences().scrollback,
  });

  const mouseEncoding = trackMouseEncoding(term);
  const fitAddon = new FitAddon();
  const serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(serializeAddon);
  // Decode real Sixel/iTerm pixels before PTY output or replay arrives.
  term.loadAddon(new ImageAddon({ storageLimit: 32, pixelLimit: 4096 * 4096 }));
  term.loadAddon(new WebLinksAddon(activateExternalWebLink));
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  attachClipboardKeys(term);
  const unsubscribePreferences = subscribeTerminalPreferences((p) => {
    term.options.scrollback = p.scrollback;
  });
  const unsubscribeTheme = subscribeAppearance(() => {
    term.options.theme = terminalTheme();
  });
  // Opacity sliders only restyle CSS; terminals redraw when transparency turns on/off.
  let translucent = getTransparency().enabled;
  const unsubscribeTransparency = subscribeTransparency(() => {
    if (getTransparency().enabled === translucent) {
      return;
    }
    translucent = !translucent;
    term.options.allowTransparency = translucent;
    term.options.theme = terminalTheme();
  });

  return {
    term,
    fitAddon,
    serializeAddon,
    mouseEncoding,
    disposePreferences: () => {
      unsubscribePreferences();
      unsubscribeTheme();
      unsubscribeTransparency();
    },
  };
}
