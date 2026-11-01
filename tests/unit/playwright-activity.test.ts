import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { observeActions } = createRequire(import.meta.url)(
  "../../src/testing/assets/playwright-activity.cjs",
);

it("observes locator chains, preserves results/errors, and never includes filled values", async () => {
  const events: any[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failure = new Error("original error");
  const locator = {
    toString: () => "getByRole('textbox', { name: 'Password' })",
    first() {
      return this;
    },
    fill: async (_value: string) => {
      await blocked;
      return 42;
    },
    click: async () => {
      throw failure;
    },
  };
  const page = { getByRole: () => locator };
  const flush = observeActions(
    page,
    "p1",
    async (event: any) => {
      events.push(event);
    },
    () => ({}),
  );
  const filling = page.getByRole().first().fill("typed-secret-value");
  await flush();
  expect(events[0]).toMatchObject({ status: "running", label: "Fill · Password" });
  release();
  expect(await filling).toBe(42);
  await flush();
  await expect(page.getByRole().click()).rejects.toBe(failure);
  await flush();
  expect(events.map((e) => e.status)).toEqual(["running", "completed", "running", "failed"]);
  expect(events[0].activityId).toBe(events[1].activityId);
  expect(JSON.stringify(events)).not.toContain("original error");
  expect(JSON.stringify(events)).not.toContain("typed-secret-value");
});

it("keeps observation failures separate from test execution and omits URL queries", async () => {
  const events: any[] = [];
  const page = { goto: async (url: string) => url };
  const flush = observeActions(
    page,
    "p1",
    async (event: any) => {
      events.push(event);
      throw new Error("offline");
    },
    () => ({}),
  );
  const url = "https://example.test/checkout?token=secret#hidden";
  expect(await page.goto(url)).toBe(url);
  await flush();
  expect(events[0].label).toBe("Navigate · example.test/checkout");
  expect(JSON.stringify(events)).not.toContain("secret");
});
