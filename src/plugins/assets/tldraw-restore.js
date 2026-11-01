// Restore only acknowledged canvas data; fresh session/transport fields stay untouched.
(() => {
  const encoded = document.currentScript?.dataset.cairngormCanvas;
  if (!encoded) return;
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const snapshot = JSON.parse(new TextDecoder().decode(bytes));
  const bootstrap = window.__TLDRAW_BOOTSTRAP__;
  if (!bootstrap || bootstrap.canvasId !== snapshot.canvasId) {
    throw new Error("The tldraw checkpoint does not match this canvas.");
  }
  for (const field of ["checkpointId", "shapes", "assets", "bindings"]) {
    bootstrap[field] = snapshot[field];
  }
})();
