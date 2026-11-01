import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { RefObject } from "preact";
// Reserve contexts synchronously, including after the dynamic import resolves.
let webglContexts = 0;
export function createTerminalWebgl(
  term: Terminal,
  termRef: RefObject<HTMLDivElement>,
  isDisposed: () => boolean,
) {
  // WebGL with safety verification
  let webglAddon: import("@xterm/addon-webgl").WebglAddon | null = null;
  const releaseWebgl = () => {
    if (!webglAddon) {
      return;
    }
    try {
      webglAddon.dispose();
    } catch {
      /* gone */
    }
    webglAddon = null;
    webglContexts = Math.max(0, webglContexts - 1);
    termRef.current?.querySelector("canvas")?.removeAttribute("data-xterm-gl");
  };
  const verifyAndEnableWebGL = () => {
    setTimeout(() => {
      if (isDisposed()) {
        return;
      }
      if (webglContexts >= 2) {
        return;
      } // cap race-free (see above)
      const canvas = termRef.current?.querySelector("canvas");
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        return;
      }
      import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
          if (isDisposed()) {
            return;
          }
          if (webglContexts >= 2) {
            return;
          } // re-check after the async import
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => releaseWebgl());
          try {
            term.loadAddon(webgl);
            webglAddon = webgl;
            webglContexts++;
            const glCanvas = termRef.current?.querySelector("canvas");
            if (glCanvas) {
              glCanvas.setAttribute("data-xterm-gl", "1");
            }
          } catch {
            /* canvas fallback */
          }
        })
        .catch(() => {});
    }, 500);
  };

  return { schedule: verifyAndEnableWebGL, dispose: releaseWebgl };
}
