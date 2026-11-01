// Back / Forward for Cairngorm itself, like an editor's navigation history:
// where you were (view, terminal group, focused pane / open file)
// — never code edits or agent actions. Pure store; the App records the current
// location and applies what back()/forward() return.

export interface NavLocation {
  view: string;
  groupId: string | null;
  tabId: string | null;
}

const MAX = 60;
let entries: NavLocation[] = [];
let index = -1;
let adopting = false; // the next record() is the state a back/forward produced
const listeners = new Set<() => void>();

const same = (a: NavLocation, b: NavLocation) =>
  a.view === b.view && a.groupId === b.groupId && a.tabId === b.tabId;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeNav(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The app settled on `loc`. A new place truncates the forward history. */
export function recordNav(loc: NavLocation) {
  const cur = entries[index];
  if (adopting) {
    // after back/forward: keep our position, just store what the app really
    // showed (a closed pane may have resolved to its group's active one)
    adopting = false;
    if (cur) {
      entries[index] = loc;
    }
    emit();
    return;
  }
  if (cur && same(cur, loc)) {
    return;
  }
  entries = entries.slice(0, index + 1);
  entries.push(loc);
  if (entries.length > MAX) {
    entries.shift();
  }
  index = entries.length - 1;
  emit();
}

/** Step back (-1) or forward (+1) to the nearest place that still exists. */
export function stepNav(dir: -1 | 1, exists: (loc: NavLocation) => boolean): NavLocation | null {
  const here = entries[index];
  for (let i = index + dir; i >= 0 && i < entries.length; i += dir) {
    const loc = entries[i];
    if (!exists(loc) || (here && same(loc, here))) {
      continue;
    }
    index = i;
    adopting = true;
    emit();
    return loc;
  }
  return null;
}

export function canNav(dir: -1 | 1): boolean {
  return dir < 0 ? index > 0 : index < entries.length - 1;
}

/** tests */
export function resetNav() {
  entries = [];
  index = -1;
  adopting = false;
  emit();
}
