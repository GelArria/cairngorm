import type { Terminal } from "@xterm/xterm";

// SerializeAddon saves mouse tracking, but omits SGR/SGR-pixel encoding.
// Observe the public parser API so restored TUIs receive the same click format.
export function trackMouseEncoding(term: Terminal): () => string {
  let mode = 0;
  for (const final of ["h", "l"]) {
    term.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
      for (const param of params) {
        if (param === 1006 || param === 1016) {
          mode = final === "h" ? param : 0;
        }
      }
      return false; // xterm must still apply the mode itself
    });
  }
  term.parser.registerEscHandler({ final: "c" }, () => {
    mode = 0;
    return false;
  });
  return () => (mode ? `\x1b[?${mode}h` : "");
}
