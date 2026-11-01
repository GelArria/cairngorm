import { afterEach, expect, spyOn, test } from "bun:test";
import { streamProxy } from "../agent/proxy.js";
import type { Model } from "../ai/types.js";

const model: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
afterEach(() => fetchSpy?.mockRestore());

test("proxy transport failures close the stream and preserve the original error message", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Proxy unavailable"));
  const stream = streamProxy(
    model,
    { messages: [] },
    {
      proxyUrl: "https://example.test/proxy",
      authToken: "test-token",
    },
  );
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  expect(events.at(-1)).toMatchObject({
    type: "error",
    reason: "error",
    error: { errorMessage: "Proxy unavailable", stopReason: "error" },
  });
  expect((await stream.result()).errorMessage).toBe("Proxy unavailable");
});
