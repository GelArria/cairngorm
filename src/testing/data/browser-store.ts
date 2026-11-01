export interface BrowserFrame {
  type: "frame" | "closed";
  pageId: string;
  timestamp: number;
  image?: string;
  imageId?: string;
  url?: string;
  title?: string;
  testName?: string;
  width?: number;
  height?: number;
  browserName?: "chromium" | "firefox" | "webkit";
  projectName?: string;
}
export interface BrowserStream extends BrowserFrame {
  receivedAt: number;
}
const streams = new Map<string, BrowserStream[]>();
const listeners = new Map<string, Set<() => void>>();
const notify = (id: string) => listeners.get(id)?.forEach((fn) => fn());

export function isBrowserFrame(event: BrowserFrame): boolean {
  if (
    !event ||
    !["frame", "closed"].includes(event.type) ||
    typeof event.pageId !== "string" ||
    !event.pageId ||
    event.pageId.length > 128 ||
    !Number.isFinite(event.timestamp)
  ) {
    return false;
  }
  if (event.browserName != null && !["chromium", "firefox", "webkit"].includes(event.browserName)) {
    return false;
  }
  if (
    event.projectName != null &&
    (typeof event.projectName !== "string" || event.projectName.length > 512)
  ) {
    return false;
  }
  if (event.type === "frame") {
    const binary =
      typeof event.imageId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event.imageId);
    const legacy =
      typeof event.image === "string" &&
      /^[A-Za-z0-9+/=]+$/.test(event.image) &&
      event.image.length <= 1_800_000;
    if (
      !(event.imageId == null ? legacy : binary) ||
      !Number.isInteger(event.width) ||
      event.width! <= 0 ||
      event.width! > 16384 ||
      !Number.isInteger(event.height) ||
      event.height! <= 0 ||
      event.height! > 16384
    ) {
      return false;
    }
  }
  return true;
}
export function publishBrowserFrame(id: string, event: BrowserFrame) {
  if (!isBrowserFrame(event)) {
    return false;
  }
  const previous = streams.get(id) ?? [];
  const current = previous.find((s) => s.pageId === event.pageId);
  if (!current && event.type === "closed") {
    return false;
  }
  if (current && (current.type === "closed" || current.timestamp > event.timestamp)) {
    return false;
  }
  const next =
    event.type === "closed"
      ? { ...current!, type: event.type, timestamp: event.timestamp, receivedAt: Date.now() }
      : {
          ...current,
          ...event,
          image: event.image,
          imageId: event.imageId,
          receivedAt: Date.now(),
        };
  streams.set(
    id,
    (current
      ? previous.map((s) => (s.pageId === event.pageId ? next : s))
      : [...previous, next]
    ).slice(-12),
  );
  notify(id);
  return !previous.length;
}

export function forgetBrowserStreams(id: string) {
  streams.delete(id);
  notify(id);
}
export function hasActiveBrowserStreams(id: string) {
  return streams.get(id)?.some((s) => s.type === "frame") ?? false;
}
export function hasBrowserPage(id: string, pageId: string) {
  return streams.get(id)?.some((s) => s.pageId === pageId) ?? false;
}
export function finishBrowserStreams(id: string) {
  const previous = streams.get(id);
  if (!previous) {
    return;
  }
  streams.set(
    id,
    previous.map((s) => ({ ...s, type: "closed" })),
  );
  notify(id);
}

export const getBrowserStreams = (id: string): BrowserStream[] => streams.get(id) ?? [];

export function subscribeBrowserStreams(id: string, update: () => void) {
  const group = listeners.get(id) ?? new Set<() => void>();
  listeners.set(id, group);
  group.add(update);
  return () => {
    group.delete(update);
    if (!group.size) {
      listeners.delete(id);
    }
  };
}
