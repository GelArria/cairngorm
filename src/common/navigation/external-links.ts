import { open } from "@tauri-apps/plugin-shell";

/** Both detected URLs and OSC 8 hyperlinks must bypass window.open in a desktop webview. */
export function activateExternalWebLink(event: MouseEvent, address: string): void {
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return;
  }
  if (
    address.length > 8192 ||
    url.href.length > 8192 ||
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    return;
  }
  void open(url.href).catch((error) => console.error("[links] Could not open browser", error));
}

/** Native navigation also guards PDF frames; this handles ordinary links and target=_blank. */
export function installExternalLinks(target: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) {
      return;
    }
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.origin === window.location.origin) {
      return;
    }
    activateExternalWebLink(event, link.href);
  };
  target.addEventListener("click", onClick);
  target.addEventListener("auxclick", onClick);
  return () => {
    target.removeEventListener("click", onClick);
    target.removeEventListener("auxclick", onClick);
  };
}
