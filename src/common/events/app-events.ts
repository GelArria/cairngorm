// App-wide UI requests that cross module boundaries (the terminal area asking the
// header to open Settings, or the sidebar to show Files / Git). One name each,
// dispatched on window; the owner listens.
export type SidebarModuleRequest = "calendar" | "files" | "git";

export const APP_OPEN_SETTINGS = "app-open-settings";
export const APP_OPEN_MODULE = "app-open-module";
export const APP_OPEN_FILE = "app-open-file";
export const APP_NEW_PROJECT = "app-new-project";

/** Optional page id, e.g. "providers"; otherwise Settings keeps its last page. */
export const openSettings = (page?: string) =>
  window.dispatchEvent(new CustomEvent(APP_OPEN_SETTINGS, { detail: page }));
export const openSidebarModule = (m: SidebarModuleRequest) =>
  window.dispatchEvent(new CustomEvent(APP_OPEN_MODULE, { detail: m }));
export const openFilePicker = () => window.dispatchEvent(new CustomEvent(APP_OPEN_FILE));

export function requestNewProject(): void {
  window.dispatchEvent(new CustomEvent(APP_NEW_PROJECT));
}

/** Subscribe; returns the unsubscribe. */
export function onAppEvent<T = undefined>(name: string, fn: (detail: T) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}
