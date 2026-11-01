import { expect, it, vi } from "vitest";
import {
  hasPermissionsOff,
  recordEnsured,
  subscribeLaunchPermissions,
} from "@/terminal/data/launch-permissions";

it("tracks terminals launched with permission checks off and ignores replies without a report", () => {
  const listener = vi.fn();
  const stop = subscribeLaunchPermissions(listener);
  recordEnsured("a", undefined);
  recordEnsured("a", null);
  expect(hasPermissionsOff("a")).toBe(false);
  recordEnsured("a", { permissionsOff: true });
  expect(hasPermissionsOff("a")).toBe(true);
  expect(hasPermissionsOff("b")).toBe(false);
  recordEnsured("a", { permissionsOff: true });
  expect(listener).toHaveBeenCalledTimes(1);
  recordEnsured("a", { permissionsOff: false });
  expect(hasPermissionsOff("a")).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  recordEnsured("a", { permissionsOff: true });
  expect(listener).toHaveBeenCalledTimes(2);
  expect(hasPermissionsOff(undefined)).toBe(false);
});
