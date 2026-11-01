import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/preact";
import { ProjectGem } from "@/projects/visuals";
import { CairngormGem } from "@/common/branding//cairngorm-gem";
import { setGemDisplay, toggleFrozen, useSystemMotion } from "@/appearance/data/motion-preferences";

afterEach(() => {
  cleanup();
  setGemDisplay({ heroCard: true, frozen: false, forceMotion: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("explicit motion survives OS changes; freezing only stops projects and system reset stops both", () => {
  const motion = Object.assign(new EventTarget(), { matches: true });
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0,
    clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  setGemDisplay({ frozen: false, forceMotion: false });
  const view = render(
    <>
      <ProjectGem color="#dd88aa" yaw={0.6} size={74} spin />
      <CairngormGem size={74} />
    </>,
  );
  const [project, loader] = view.container.querySelectorAll("svg");
  const step = () =>
    act(() => {
      clock += 32;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(clock));
    });
  expect(frames.size).toBe(0); // accessible system default
  act(() => toggleFrozen()); // explicit unfreeze must work even under reduced motion
  const projectBefore = project.innerHTML,
    loaderBefore = loader.innerHTML;
  step();
  expect(project.innerHTML).not.toBe(projectBefore);
  expect(loader.innerHTML).not.toBe(loaderBefore);
  for (const reduce of [false, true]) {
    act(() => {
      motion.matches = reduce;
      motion.dispatchEvent(new Event("change"));
    });
    expect(frames.size).toBe(2);
  }
  act(() => toggleFrozen());
  const frozen = project.innerHTML,
    moving = loader.innerHTML;
  step();
  expect(project.innerHTML).toBe(frozen);
  expect(loader.innerHTML).not.toBe(moving);
  act(() => useSystemMotion());
  const stillProject = project.innerHTML,
    stillLoader = loader.innerHTML;
  step();
  expect(project.innerHTML).toBe(stillProject);
  expect(loader.innerHTML).toBe(stillLoader);
  expect(frames.size).toBe(0);
  view.unmount();
});
