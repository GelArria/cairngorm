// The break: the guard reports "unchanged" although the app hosting the user's terminals
// closed or restarted with a reused PID during a test run.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { isolatedBrowserEnv, missing } from "../guard-cairngorm.mjs";

describe("Cairngorm test-run guard", () => {
  const app = { id: 12316, start: "639285279209364897" };

  it("isolates mocked browsers without changing the host environment", () => {
    const env = {
      PATH: "tools",
      NODE_OPTIONS: '--require "host/playwright-preload.cjs"',
      CAIRNGORM_TEST_ENDPOINT: "http://127.0.0.1:1/frame",
      CAIRNGORM_TEST_TOKEN: "private",
      CAIRNGORM_TEST_BINARY: "1",
      CAIRNGORM_NATIVE_PLUGIN_CHECK: "1",
    };
    expect(isolatedBrowserEnv(env)).toEqual({ PATH: "tools" });
    expect(env.CAIRNGORM_TEST_TOKEN).toBe("private");
    expect(env.NODE_OPTIONS).toContain("playwright-preload");
  });

  it("removes observer and native opt-ins regardless of Windows environment casing", () => {
    expect(
      isolatedBrowserEnv({
        Path: "tools",
        node_options: "--require host-hook.cjs",
        Cairngorm_Test_Token: "private",
        cairngorm_native_plugin_check: "1",
        E2E_REAL: "1",
        CAIRNGORM_RESTORE_EXE: "host.exe",
        CAIRNGORM_PLUGIN_ISOLATION: "{}",
      }),
    ).toEqual({ Path: "tools" });
  });

  it("passes only when every running app keeps its PID and start time", () => {
    expect(missing([app], [app, { id: 1, start: "1" }])).toEqual([]);
    expect(missing([app], [])).toEqual([app]);
    expect(missing([app], [{ id: app.id, start: "639285999999999999" }])).toEqual([app]);
    expect(missing([], [])).toEqual([]);
  });
});
