export interface BrowserActivity {
  type: "activity";
  pageId: string;
  activityId: string;
  timestamp: number;
  startedAt: number;
  label: string;
  status: "running" | "completed" | "failed" | "interrupted";
  testName?: string;
}
const activities = new Map<string, BrowserActivity[]>();
const listeners = new Map<string, Set<() => void>>();
const notify = (id: string) => listeners.get(id)?.forEach((fn) => fn());

export function isBrowserActivity(event: BrowserActivity): boolean {
  return (
    !!event &&
    event.type === "activity" &&
    ["running", "completed", "failed", "interrupted"].includes(event.status) &&
    typeof event.pageId === "string" &&
    event.pageId.length > 0 &&
    event.pageId.length <= 128 &&
    typeof event.activityId === "string" &&
    event.activityId.length > 0 &&
    event.activityId.length <= 128 &&
    typeof event.label === "string" &&
    event.label.length > 0 &&
    event.label.length <= 512 &&
    Number.isFinite(event.timestamp) &&
    Number.isFinite(event.startedAt) &&
    event.timestamp >= event.startedAt
  );
}
export function publishBrowserActivity(id: string, event: BrowserActivity) {
  if (!isBrowserActivity(event)) {
    return;
  }
  const previous = activities.get(id) ?? [];
  const current = previous.find(
    (a) => a.activityId === event.activityId && a.pageId === event.pageId,
  );
  if (current && (current.timestamp > event.timestamp || current.status !== "running")) {
    return;
  }
  activities.set(
    id,
    (current ? previous.map((a) => (a === current ? event : a)) : [...previous, event])
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(-200),
  );
  notify(id);
}
export function finishBrowserActivities(id: string, pageId?: string) {
  const previous = activities.get(id);
  if (!previous) {
    return;
  }
  activities.set(
    id,
    previous.map((a) =>
      a.status === "running" && (!pageId || a.pageId === pageId)
        ? { ...a, status: "interrupted", timestamp: Math.max(Date.now(), a.startedAt) }
        : a,
    ),
  );
  notify(id);
}
export function forgetBrowserActivities(id: string) {
  activities.delete(id);
  notify(id);
}

export const getBrowserActivities = (id: string): BrowserActivity[] => activities.get(id) ?? [];

export function subscribeBrowserActivities(id: string, update: () => void) {
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
