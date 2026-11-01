// Real native timer -> installed sidecar -> deterministic loopback provider -> durable result.
// Direct CDP attachment avoids TesterArmy 0.20's blocked about:blank navigation.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withQaProfile, waitFor } from "./qa-profile.mjs";

const calls = { success: 0, failure: 0, interrupted: 0 };
let held;
let heldClosed = false;
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const kind = ["success", "failure", "interrupted"].find((name) => body.includes(`QA-${name}`));
  if (!kind || request.url !== "/v1/chat/completions") {
    response.writeHead(400).end("Unexpected QA provider request");
    return;
  }
  calls[kind]++;
  if (kind === "interrupted") {
    held = response;
    response.once("close", () => {
      heldClosed = true;
    });
    return;
  }
  if (kind === "failure") {
    response
      .writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { message: "QA provider denied" } }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "QA timer result persisted" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await withQaProfile("scheduler-lifecycle", async (qa) => {
    fs.writeFileSync(
      path.join(qa.scratch, ".panel/agent/config.json"),
      JSON.stringify({
        provider: "openai",
        model: "qa-local",
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        keyOptional: true,
      }),
    );
    await qa.start();
    const list = () => qa.invoke("scheduled_tasks_list");
    const save = async (kind) => {
      await qa.invoke("scheduled_tasks_save", {
        input: {
          title: `QA ${kind}`,
          prompt: `QA-${kind}`,
          projectId: "qa-project",
          projectName: "QA project",
          rootPath: path.join(qa.scratch, "project"),
          agent: "cairngorm",
          nextAt: Math.floor(Date.now() / 1000) + 2,
          intervalMinutes: null,
        },
      });
      return (await list()).find((task) => task.title === `QA ${kind}`).id;
    };
    const state = (id, status) =>
      waitFor(
        async () => {
          const task = (await list()).find((task) => task.id === id);
          return task?.status === status ? task : false;
        },
        `Task ${id} never reached ${status}`,
        45000,
      );
    const successId = await save("success");
    const success = await state(successId, "succeeded");
    assert.equal(success.output, "QA timer result persisted");
    assert.equal(success.enabled, false);
    assert.equal(calls.success, 1);
    const failureId = await save("failure");
    const failure = await state(failureId, "failed");
    assert.match(failure.output, /QA provider denied|401/i);
    assert.equal(calls.failure, 1);
    const interruptedId = await save("interrupted");
    await waitFor(() => held, "Real sidecar never reached the interrupted provider");
    await state(interruptedId, "running");
    const tasksPath = path.join(
      path.dirname((await qa.invoke("config_read")).path),
      "scheduled-tasks.json",
    );
    const persisted = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
    assert.equal(persisted.find((task) => task.id === interruptedId)?.status, "running");
    await qa.stop();
    await waitFor(() => heldClosed, "Scheduled sidecar survived its owning app's exit");
    await qa.start();
    let interrupted = await state(interruptedId, "interrupted");
    assert.equal(interrupted.enabled, false);
    assert.equal(interrupted.requested, false);
    assert.equal((await state(successId, "succeeded")).output, success.output);
    assert.equal((await state(failureId, "failed")).output, failure.output);
    // Observe more than two real two-second ticks, then restart and check another tick window.
    await delay(4500);
    assert.deepEqual(calls, { success: 1, failure: 1, interrupted: 1 });
    await qa.stop();
    await qa.start();
    interrupted = await state(interruptedId, "interrupted");
    assert.equal(interrupted.enabled, false);
    assert.equal(interrupted.requested, false);
    await delay(4500);
    assert.deepEqual(calls, { success: 1, failure: 1, interrupted: 1 });
    return {
      timerToRealSidecar: true,
      loopbackProvider: true,
      successAndFailurePersisted: true,
      interruptedChildStopped: true,
      noDuplicateAfterTwoRestarts: true,
      calls,
    };
  });
} finally {
  held?.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
