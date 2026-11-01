// Iframe events do not bubble to Cairngorm. Preserve menus handled by the plugin.
window.addEventListener("contextmenu", (event) => {
  if (event.defaultPrevented) {
    return;
  }
  event.preventDefault();
  // Only pointer coordinates cross origins; the host checks both origin and source.
  window.parent.postMessage(
    {
      jsonrpc: "2.0",
      method: "cairngorm/context-menu",
      params: { x: event.clientX, y: event.clientY },
    },
    "*",
  );
});
