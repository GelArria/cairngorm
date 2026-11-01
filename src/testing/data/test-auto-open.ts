// Whether a detected test run opens its Tests view. Singleton + listeners so the
// header toggle and the App-level monitor share one value; persisted per machine.
// Off only stops new views: runs are still tracked and open views keep updating.

const STORAGE_KEY = "tests-auto-open";
const listeners = new Set<(enabled: boolean) => void>();

let enabled = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
})();

export function isTestAutoOpenEnabled(): boolean {
  return enabled;
}

export function setTestAutoOpen(next: boolean): void {
  if (next === enabled) {
    return;
  }
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    /* no storage: the choice lasts for this session */
  }
  listeners.forEach((l) => l(enabled));
}

export function subscribeTestAutoOpen(listener: (enabled: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
