import { expect, it } from "vitest";
import { cleanProfiles, shellIdentity } from "../../src/terminal/model/launch-profile";

it("retains literal arguments and distinct profiles while rejecting invalid stored entries", () => {
  const profile = {
    id: "one",
    name: "Pi",
    program: "C:/CLI Tools/pi.js",
    args: ["", "folder with spaces", "; & Ω"],
    shell: null,
  };
  const profiles = cleanProfiles([
    profile,
    { ...profile, id: "two" },
    profile,
    { ...profile, id: "invalid", args: [3] },
    null,
  ]);
  expect(profiles.map((value) => value.id)).toEqual(["one", "two"]);
  expect(profiles[0].args).toEqual(profile.args);
  expect(profiles[0].args).not.toBe(profile.args);
  expect(cleanProfiles({})).toEqual([]);
});

it("distinguishes WSL distributions sharing an executable but normalizes Windows path casing", () => {
  const ubuntu = { path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Ubuntu"] };
  expect(shellIdentity(ubuntu)).not.toBe(shellIdentity({ ...ubuntu, args: ["-d", "Debian"] }));
  expect(shellIdentity(ubuntu)).toBe(
    shellIdentity({ ...ubuntu, path: "c:/windows/system32/WSL.EXE" }),
  );
});
