// Isolated native QA only: NATIVE_CDP_URL must not point to the user's installed app.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const endpoint = process.env.NATIVE_CDP_URL;
assert.ok(endpoint && !endpoint.endsWith(":9222"), "Set the isolated QA CDP endpoint");
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url() === "http://localhost:1420/");
  assert.ok(page, "Unmocked native dev window not found");
  const result = await page.evaluate(
    async ({ node, cwd }) => {
      const { listen } = await import("/node_modules/@tauri-apps/api/event.js");
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const sessionId = `observer-native-${Date.now()}`;
      const updates = [];
      const stop = await listen(`pty-test-${sessionId}`, ({ payload }) => updates.push(payload));
      const program =
        "console.log('Running 2000 tests using 1 worker'); for(let i=0;i<2000;i++) console.log('✓ case '+i); console.log('2000 passed (1s)'); setTimeout(()=>{},1000)";
      const wait = async (predicate) => {
        for (let i = 0; i < 150; i++) {
          const value = await invoke("pty_test_run", { sessionId });
          if (predicate(value)) return value;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error("Native test snapshot timed out");
      };
      try {
        await invoke("pty_ensure", {
          sessionId,
          shell: node,
          args: ["-e", program],
          cwd,
          env: [],
          parseJsonl: false,
          killOnAgentEnd: false,
        });
        const restored = await wait((value) => value?.run?.status === "passed");
        for (let i = 0; i < 100 && updates.at(-1)?.run.status !== "passed"; i++)
          await new Promise((resolve) => setTimeout(resolve, 40));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const afterExit = await invoke("pty_test_run", { sessionId });
        // Recreate without killing/removing the slot: exactly the production same-ID ensure path.
        const nextProgram =
          "console.log('Running 1 test using 1 worker'); console.log('1 passed (1s)'); setTimeout(()=>{},500)";
        await invoke("pty_ensure", {
          sessionId,
          shell: node,
          args: ["-e", nextProgram],
          cwd,
          env: [],
          parseJsonl: false,
          killOnAgentEnd: false,
        });
        const recreated = await wait(
          (value) => value?.generation > afterExit.generation && value?.run?.status === "passed",
        );
        for (let i = 0; i < 100 && updates.at(-1)?.generation !== recreated.generation; i++)
          await new Promise((resolve) => setTimeout(resolve, 40));
        return { restored, afterExit, recreated, updates };
      } finally {
        stop();
        await invoke("pty_kill", { sessionId });
      }
    },
    { node: process.execPath, cwd: process.cwd() },
  );
  const originalUpdates = result.updates.filter(
    (update) => update.generation === result.restored.generation,
  );
  for (const update of [result.restored, result.afterExit, originalUpdates.at(-1)]) {
    assert.equal(update.run.status, "passed");
    assert.equal(update.run.passed, 2000);
    assert.equal(update.run.results.length, 500);
    assert.equal(update.run.output.length, 600);
  }
  assert.ok(result.updates.length < 100, "Updates should be coalesced, not one per result");
  assert.ok(
    result.updates.some((update) => update.started),
    "Run start must survive coalescing",
  );
  assert.equal(result.restored.started, false, "Restoring a snapshot is not a new execution");
  for (let i = 1; i < originalUpdates.length; i++)
    assert.ok(originalUpdates[i].revision >= originalUpdates[i - 1].revision);
  assert.ok(result.recreated.generation > result.restored.generation);
  assert.ok(result.recreated.revision < result.restored.revision);
  assert.equal(result.recreated.run.passed, 1);
  assert.equal(result.updates.at(-1).generation, result.recreated.generation);
  assert.equal(result.updates.at(-1).run.passed, 1);
  console.log(
    `PASS: native PTY → Rust → WebView; 2000 tests, ${originalUpdates.length} updates, bounded results/output, snapshot restoration and EOF preserved`,
  );
  console.log(
    "PASS: dead PTY recreated with same session ID; newer generation accepts a shorter 1-test run with lower revision",
  );
} finally {
  await browser.close();
}
