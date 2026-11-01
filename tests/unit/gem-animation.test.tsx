import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/preact";
import { ProjectGem } from "@/projects/visuals";
import { CairngormGem } from "@/common/branding//cairngorm-gem";
import {
  getGemDisplay,
  setGemDisplay,
  toggleFrozen,
  toggleHeroCard,
} from "@/appearance/data/motion-preferences";

let frames: Map<number, FrameRequestCallback>;
let motion: EventTarget & { matches: boolean };
let clock: number;
let hidden: boolean;
let focused: boolean;
let observers: Set<IntersectionObserverCallback>;

beforeEach(() => {
  frames = new Map();
  clock = 0;
  hidden = false;
  focused = true;
  observers = new Set();
  let id = 0;
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() {
        observers.add(this.cb);
      }
      disconnect() {
        observers.delete(this.cb);
      }
    },
  );
  setGemDisplay({ heroCard: true, frozen: false, forceMotion: false });
});
afterEach(() => {
  setGemDisplay({ heroCard: true, frozen: false, forceMotion: false });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function step(ms = 32) {
  act(() => {
    clock += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(clock));
  });
}
function preference(reduce: boolean) {
  act(() => {
    motion.matches = reduce;
    motion.dispatchEvent(new Event("change"));
  });
}
function onScreen(value: boolean) {
  act(() =>
    observers.forEach((cb) =>
      cb([{ isIntersecting: value }] as IntersectionObserverEntry[], {} as IntersectionObserver),
    ),
  );
}
function windowFocus(value: boolean) {
  act(() => {
    focused = value;
    window.dispatchEvent(new Event(value ? "focus" : "blur"));
  });
}
function visibility(value: boolean) {
  act(() => {
    hidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

for (const kind of ["project", "loader"] as const) {
  const gem = () =>
    kind === "project" ? (
      <ProjectGem color="#dd88aa" yaw={0.6} size={74} spin />
    ) : (
      <CairngormGem size={74} />
    );
  describe(`${kind} gem animation`, () => {
    it("works without matchMedia and with the legacy WebView listener API", () => {
      vi.stubGlobal("matchMedia", undefined);
      const view = render(gem());
      const before = view.container.querySelector("svg")!.innerHTML;
      step();
      expect(view.container.querySelector("svg")!.innerHTML).not.toBe(before);
      view.unmount();
      motion.matches = true;
      const add = vi.fn((cb: EventListener) => motion.addEventListener("change", cb));
      const remove = vi.fn((cb: EventListener) => motion.removeEventListener("change", cb));
      vi.stubGlobal("matchMedia", () => ({
        get matches() {
          return motion.matches;
        },
        addListener: add,
        removeListener: remove,
      }));
      const legacy = render(gem());
      const svg = legacy.container.querySelector("svg")!;
      const still = svg.innerHTML;
      preference(false);
      step();
      expect(svg.innerHTML).not.toBe(still);
      legacy.unmount();
      expect(add.mock.calls.length).toBeGreaterThan(0);
      expect(remove.mock.calls.length).toBe(add.mock.calls.length);
      expect(frames.size).toBe(0);
    });

    it("starts hidden and survives 100 motion/restore cycles with one loop", () => {
      hidden = true;
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      expect(frames.size).toBe(0);
      visibility(false);
      for (let n = 0; n < 100; n++) {
        preference(true);
        visibility(true);
        step(60_000);
        preference(false);
        visibility(false);
        const before = svg.innerHTML;
        step();
        expect(svg.innerHTML === before).toBe(false);
        expect(frames.size).toBe(1);
      }
    });

    it("stops its loop off screen then animates when it returns", () => {
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      onScreen(false);
      const before = svg.innerHTML;
      expect(frames.size).toBe(0);
      step(60_000);
      expect(svg.innerHTML).toBe(before);
      onScreen(true);
      step();
      expect(svg.innerHTML).not.toBe(before);
      expect(frames.size).toBe(1);
      view.unmount();
      expect(observers.size).toBe(0);
    });

    it("starts and keeps turning while visible without window focus", () => {
      focused = false;
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      const initial = svg.innerHTML;
      step();
      expect(svg.innerHTML).not.toBe(initial);
      windowFocus(false);
      const before = svg.innerHTML;
      step();
      expect(svg.innerHTML).not.toBe(before);
      expect(frames.size).toBe(1);
      visibility(true);
      expect(frames.size).toBe(0);
      visibility(false);
      step();
      expect(svg.innerHTML).not.toBe(before);
      expect(frames.size).toBe(1);
      windowFocus(true);
      expect(frames.size).toBe(1);
    });

    it("resumes when reduced motion was enabled at startup, then switched off", () => {
      motion.matches = true;
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      const still = svg.innerHTML;
      step();
      expect(svg.innerHTML).toBe(still);
      preference(false);
      step();
      expect(svg.innerHTML).not.toBe(still);
      expect(frames.size).toBe(1);
    });

    it("responds to live motion changes without remounting or blanking the gem", () => {
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      step();
      preference(true);
      const still = svg.innerHTML;
      step();
      expect(svg.innerHTML).toBe(still);
      expect(svg.querySelectorAll("line").length).toBeGreaterThan(0);
      preference(false);
      step();
      expect(svg.innerHTML).not.toBe(still);
      expect(frames.size).toBe(1);
      view.unmount();
      expect(frames.size).toBe(0);
    });

    it("pauses while hidden and recovers after focus/pageshow without duplicate loops", () => {
      const view = render(gem());
      const svg = view.container.querySelector("svg")!;
      step();
      visibility(true);
      const still = svg.innerHTML;
      step(60_000);
      expect(svg.innerHTML).toBe(still);
      visibility(false);
      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
      });
      step();
      expect(svg.innerHTML).not.toBe(still);
      expect(frames.size).toBe(1);
    });
  });
}

it("frozen stops every project gem where it stands; loaders keep turning", () => {
  const a = render(<ProjectGem color="#dd88aa" yaw={0.6} size={74} spin />);
  const b = render(<ProjectGem color="#aa88dd" yaw={0.6} size={26} spin />);
  const loader = render(<CairngormGem size={74} />);
  const p = a.container.querySelector("svg")!,
    q = b.container.querySelector("svg")!,
    l = loader.container.querySelector("svg")!;
  step();
  act(() => setGemDisplay({ frozen: true }));
  const still1 = p.innerHTML,
    still2 = q.innerHTML,
    moved = l.innerHTML;
  step();
  expect(p.innerHTML).toBe(still1); // hero-sized gem: frozen
  expect(q.innerHTML).toBe(still2); // tile/mini gem: frozen too
  expect(l.innerHTML).not.toBe(moved); // a frozen loader would look broken
  act(() => setGemDisplay({ frozen: false }));
  step();
  expect(p.innerHTML).not.toBe(still1);
  expect(q.innerHTML).not.toBe(still2);
  a.unmount();
  b.unmount();
  loader.unmount();
  expect(frames.size).toBe(0);
});

// jsdom's localStorage is opaque here — cross-reload persistence is covered by
// the e2e spec; this locks the in-memory toggle contract.
it("gem display prefs toggle (hero card / freeze)", () => {
  expect(getGemDisplay()).toEqual({ heroCard: true, frozen: false, forceMotion: false });
  act(() => {
    toggleHeroCard();
    toggleFrozen();
  });
  expect(getGemDisplay()).toEqual({ heroCard: false, frozen: true, forceMotion: false });
  act(() => toggleHeroCard());
  expect(getGemDisplay().heroCard).toBe(true);
});

it("fps caps redraws but keeps the loop alive", () => {
  const view = render(<ProjectGem color="#dd88aa" yaw={0.6} size={74} spin fps={20} />);
  const svg = view.container.querySelector("svg")!;
  step(50);
  const drawn = svg.innerHTML;
  step(16); // under 50 ms since the last redraw: skipped
  expect(svg.innerHTML).toBe(drawn);
  expect(frames.size).toBe(1);
  step(40);
  expect(svg.innerHTML).not.toBe(drawn);
});

it("project spin toggles and cut changes keep a single live mesh/loop", () => {
  const props = { color: "#dd88aa", yaw: 0.6, size: 74 };
  const view = render(<ProjectGem {...props} spin />);
  const svg = view.container.querySelector("svg")!;
  step();
  view.rerender(<ProjectGem {...props} spin={false} />);
  const still = svg.innerHTML;
  step();
  expect(svg.innerHTML).toBe(still);
  view.rerender(<ProjectGem {...props} cut="pear" spin />);
  step();
  expect(svg.innerHTML).not.toBe(still);
  expect(svg.querySelectorAll("polygon")).toHaveLength(1);
  expect(frames.size).toBe(1);
});
