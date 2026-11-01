// Splash intro timeline (Doop "Motion — Logo intro", variant Splash): the loader
// spins at view speed, decelerates and stops exactly in the logo pose, then the
// name rises letter by letter. All times in ms from mount.
import { GEM_REST } from "../../common/branding/gem-draw";

export const SPLASH = {
  spin: 700, // constant loader speed
  settle: 1400, // cubic ease-out into the rest pose
  name: 1900, // first letter starts rising (45 ms stagger)
  leave: 3300, // overlay starts fading
  fade: 500,
  reducedLeave: 1200,
} as const;

export const SPIN_SPEED = 0.0013; // rad/ms — the view loader's speed
export const SETTLED_AT = SPLASH.spin + SPLASH.settle;
export const LETTER_STAGGER = 45;

const TAU = Math.PI * 2;
const easeOut = (x: number) => 1 - (1 - x) ** 3;
// Cubic ease-out starts with slope 3·d/settle; d = speed·settle/3 keeps the speed continuous.
const DECEL = (SPIN_SPEED * SPLASH.settle) / 3;
const YAW0 = GEM_REST.yaw + TAU - SPIN_SPEED * SPLASH.spin - DECEL;

/** Gem draw(t, yaw) arguments at `ms`; from SETTLED_AT on it is exactly the rest pose (+1 turn). */
export function splashPose(ms: number): { t: number; yaw: number } {
  const t = Math.max(0, ms);
  const u = Math.min(1, Math.max(0, (t - SPLASH.spin) / SPLASH.settle));
  const yaw = YAW0 + SPIN_SPEED * Math.min(t, SPLASH.spin) + DECEL * easeOut(u);
  // the pitch bob is driven by t: run it so it lands on the rest frame too
  return { t: GEM_REST.t - SETTLED_AT + Math.min(t, SETTLED_AT), yaw };
}
