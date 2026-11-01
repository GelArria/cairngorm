// Lucide refresh-cw, as markup (the swap badge is built with the DOM, not JSX)
const SWAP_BADGE_SVG =
  '<svg class="h-12 w-12 text-primary drop-shadow-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
export const ANTS_HTML =
  '<i class="ants-strip ants-t"></i><i class="ants-strip ants-v ants-r"></i><i class="ants-strip ants-b"></i><i class="ants-strip ants-v ants-l"></i>';

export function createPaneDragPreview(paneEl: HTMLElement) {
  // Swap preview: dimmed origin + pulsing target with ⇄ badge
  // Frame above the .pane-frame overlay (on top of the xterm); the wrapper only carries opacity.
  let st = document.getElementById("swap-preview-style") as HTMLStyleElement | null;
  if (!st) {
    st = document.createElement("style");
    st.id = "swap-preview-style";
    document.head.appendChild(st);
  }
  // .pane-dragging: the REAL pane floats following the cursor (transform on the
  // same grid node — zero remount, WebGL intact). pointer-events:none
  // → elementFromPoint sees the panes below, not the floating one.
  // .ants: LONG stripes (18px/10px) drifting clockwise. 4 strips
  // with animated transform (GPU/compositor — background-position repaints on
  // CPU and looks clunky with xterm WebGL). Oversize ±period = seamless loop.
  st.textContent = `
.swap-preview .pane-frame { border-color: transparent !important; }
.ants { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.ants-strip { position: absolute; left: -28px; right: -28px; top: 0; height: 2px; background: repeating-linear-gradient(90deg, #22c55e 0 18px, transparent 18px 28px); animation: ants-x 4s linear infinite; will-change: transform; }
.ants-b { top: auto; bottom: 0; animation-direction: reverse; }
.ants-v { left: auto; right: auto; top: -28px; bottom: -28px; height: auto; width: 2px; background: repeating-linear-gradient(0deg, #22c55e 0 18px, transparent 18px 28px); animation-name: ants-y; }
.ants-l { left: 0; animation-direction: reverse; }
.ants-r { right: 0; }
@keyframes ants-x { to { transform: translateX(28px); } }
@keyframes ants-y { to { transform: translateY(28px); } }
.pane-dragging { z-index: 60 !important; pointer-events: none !important; box-shadow: 0 12px 32px rgba(0,0,0,.55); will-change: transform; }
.swap-contact { opacity: 0.35; }`;
  let previewTarget: HTMLElement | null = null;
  let previewBadge: HTMLElement | null = null;
  let previewAnts: HTMLElement | null = null;
  // Valid contact (swap/gap): the DRAGGED pane becomes transparent
  // to see the target/gap below; on losing contact it turns opaque again.
  const clearPreview = () => {
    paneEl.classList.remove("swap-contact");
    if (previewTarget) {
      previewTarget.classList.remove("swap-preview", "animate-pulse");
      previewBadge?.remove();
      previewBadge = null;
      previewAnts?.remove();
      previewAnts = null;
      previewTarget = null;
    }
  };
  const showPreview = (target: HTMLElement) => {
    if (previewTarget !== target) {
      clearPreview();
      previewTarget = target;
      target.classList.add("swap-preview", "animate-pulse");
      previewBadge = document.createElement("div");
      previewBadge.className =
        "absolute inset-0 z-30 flex items-center justify-center pointer-events-none";
      previewBadge.innerHTML = SWAP_BADGE_SVG;
      target.appendChild(previewBadge);
      // Animated stripe borders on the target (GPU, smooth loop)
      previewAnts = document.createElement("div");
      previewAnts.className = "ants";
      previewAnts.innerHTML = ANTS_HTML;
      target.appendChild(previewAnts);
    }
    paneEl.classList.add("swap-contact"); // contact → the dragged one turns transparent
  };

  return { clear: clearPreview, show: showPreview };
}
