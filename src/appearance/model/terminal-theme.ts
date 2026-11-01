import type { ITheme } from "@xterm/xterm";
import { getAppearancePalette } from "../data/store";
import { getTransparency } from "../data/transparency";
import { mix } from "./colors";

/** Change renderer colors without restarting the PTY or discarding scrollback. */
export function terminalTheme(): ITheme {
  const c = getAppearancePalette();
  const colors = c.dark
    ? ["#ef646c", "#73c991", "#e6bf70", "#7ba9ed", "#c397e0", "#68bdcc"]
    : ["#b42332", "#247442", "#8a6418", "#235ab2", "#8542a0", "#167486"];
  const [red, green, yellow, blue, magenta, cyan] = colors;
  return {
    // Clear when the window is translucent: the pane paints the tinted glass.
    background: getTransparency().enabled ? "#00000000" : c.background,
    foreground: c.foreground,
    cursor: c.accent,
    cursorAccent: c.background,
    selectionBackground: mix(c.background, c.accent, 0.3),
    selectionForeground: c.foreground,
    black: c.dark ? c.background : "#20242b",
    white: c.foreground,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    brightBlack: c.muted,
    brightWhite: c.dark ? "#ffffff" : c.foreground,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
  };
}
