import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const json = (path: string) => JSON.parse(read(path));
const version = json("package.json").version;

describe("release version", () => {
  it("keeps the app, sidecar and package lock on the same version", () => {
    expect(json("src-tauri/tauri.conf.json").version).toBe(version);
    expect(json("src/agent/core/package.json").version).toBe(version);
    for (const path of ["package-lock.json", "src/agent/core/package-lock.json"]) {
      const lock = json(path);
      expect(lock.version).toBe(version);
      expect(lock.packages[""].version).toBe(version);
    }
  });

  it("keeps the native manifest and lock on the app version", () => {
    const manifest = read("src-tauri/Cargo.toml").split(/\r?\n\[/)[0];
    expect(manifest.match(/^version = "([^"]+)"/m)?.[1]).toBe(version);
    const native = read("src-tauri/Cargo.lock")
      .split("[[package]]")
      .find((entry) => /^name = "cairngorm"$/m.test(entry));
    expect(native?.match(/^version = "([^"]+)"/m)?.[1]).toBe(version);
  });

  it.each(["windows", "macos", "linux"])(
    "%s installers inherit the shared Tauri version",
    (platform) => {
      expect(json(`src-tauri/tauri.${platform}.conf.json`).version).toBeUndefined();
    },
  );
});
