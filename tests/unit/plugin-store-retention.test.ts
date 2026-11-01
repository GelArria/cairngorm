import { describe, expect, it } from "vitest";
import {
  claimPluginInput,
  finishPluginCall,
  getPluginCall,
  publishPluginCall,
  retainPluginCalls,
} from "@/plugins/data/plugin-store";
import type { PluginCall } from "@/plugins/model/types";

const call = (id: string): PluginCall => ({
  id,
  plugin: "tldraw",
  pluginName: "tldraw",
  terminal: "retained-terminal",
  tool: { name: "exec" },
  arguments: {},
  viewUrl: "http://localhost/view",
  view: null,
});

describe("plugin call retention", () => {
  it("keeps a pane's call and one-shot input through more than 64 later calls", () => {
    publishPluginCall(call("retained-first"));
    expect(claimPluginInput("retained-first")).toBe(true);
    finishPluginCall("retained-first", {});
    for (let i = 0; i < 80; i++) {
      const id = `retained-next-${i}`;
      publishPluginCall(call(id));
      finishPluginCall(id, {});
      retainPluginCalls(["retained-first"]);
    }
    expect(getPluginCall("retained-first")).toBeDefined();
    expect(claimPluginInput("retained-first")).toBe(false);
    expect(getPluginCall("retained-next-0")).toBeUndefined();
    retainPluginCalls([]);
    expect(getPluginCall("retained-first")).toBeUndefined();
  });

  it("does not evict a pending callback even without a visible pane", () => {
    publishPluginCall(call("retained-pending"));
    for (let i = 0; i < 80; i++) {
      publishPluginCall(call(`closed-next-${i}`));
      finishPluginCall(`closed-next-${i}`, {});
    }
    retainPluginCalls([]);
    expect(getPluginCall("retained-pending")?.status).toBe("running");
  });
});
