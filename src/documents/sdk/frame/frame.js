// Cairngorm's own frame between a pane and a provider page. It runs on the document host
// (d-<key>) and loads the provider on its sibling origin (v-<key>). The frame's CSP allows
// only that origin as a child, so a provider cannot navigate itself anywhere else, and the
// provider sandbox stops it from navigating this frame or the app. Messages are relayed
// unchanged in both directions.
(() => {
  const providerOrigin = location.origin.replace("//d-", "//v-");
  const entry = new URLSearchParams(location.search).get("entry") ?? "";
  // A relative path inside the provider bundle: no scheme, host, parent segment or backslash.
  if (
    !entry ||
    /^[a-z][a-z0-9+.-]*:|^\/|\\|(^|\/)\.\.(\/|$)/i.test(entry) ||
    providerOrigin === location.origin
  ) {
    return;
  }
  const child = document.getElementById("provider");
  const parentOrigin = location.ancestorOrigins?.[0] ?? "*";
  addEventListener("message", (event) => {
    if (event.source === parent && (parentOrigin === "*" || event.origin === parentOrigin)) {
      child.contentWindow?.postMessage(event.data, providerOrigin);
    } else if (event.source === child.contentWindow && event.origin === providerOrigin) {
      parent.postMessage(event.data, parentOrigin);
    }
  });
  // Whatever the entry text, only a page on the provider's own origin is ever loaded.
  const target = new URL(entry, `${providerOrigin}/`);
  if (target.origin !== providerOrigin) {
    return;
  }
  child.src = target.href;
})();
