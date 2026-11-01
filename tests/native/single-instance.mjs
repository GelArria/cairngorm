// Release-only second launch: handoff must not replace the first profile's gateway or work.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { withQaProfile, waitFor } from "./qa-profile.mjs";

await withQaProfile("single-instance", async (qa) => {
  const first = path.join(qa.scratch, "project/working.txt");
  const second = path.join(qa.scratch, "project/handoff.txt");
  fs.writeFileSync(first, "Original saved content");
  fs.writeFileSync(second, "Second launch reached the original window");
  await qa.start([first]);
  await qa.page
    .getByRole("dialog", { name: "Set up the Cairngorm agent" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(qa.page.locator(".cm-content:visible")).toContainText("Original saved content");
  await qa.page.locator(".cm-content:visible").fill("Unsaved work must survive the second launch");
  await qa.invoke("plugins_connect_agents");
  const gatewayFile = path.join(
    path.dirname((await qa.invoke("config_read")).path),
    "plugins/gateway.json",
  );
  await waitFor(() => fs.existsSync(gatewayFile), "QA gateway was not created");
  const original = fs.readFileSync(gatewayFile, "utf8");
  const gateway = JSON.parse(original);
  assert.equal(gateway.pid, qa.pid);
  const endpoint = new URL(gateway.url);
  assert.equal(endpoint.hostname, "127.0.0.1");
  const catalog = async () => {
    const response = await fetch(`${gateway.url}/catalog`, {
      headers: { Authorization: `Bearer ${gateway.secret}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const before = await catalog();
  const child = spawn(qa.executable, [second], { env: qa.env, stdio: "ignore" });
  let finished = false;
  let status;
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      finished = true;
      status = code;
      resolve();
    });
  });
  void exited.catch(() => {});
  try {
    await waitFor(() => finished, "Second release instance did not hand off and exit", 15000);
    await exited;
    assert.equal(status, 0);
    assert.equal(
      fs.readFileSync(gatewayFile, "utf8"),
      original,
      "Second launch replaced the gateway discovery",
    );
    assert.deepEqual(await catalog(), before);
    await expect(qa.page.locator(".cm-content:visible")).toContainText(
      "Second launch reached the original window",
    );
    await qa.page.getByRole("tab", { name: /working\.txt/ }).click();
    await expect(qa.page.locator(".cm-content:visible")).toContainText(
      "Unsaved work must survive the second launch",
    );
    assert.equal(fs.readFileSync(first, "utf8"), "Original saved content");
    return {
      releaseHandoff: true,
      secondInstanceExited: true,
      originalPid: qa.pid,
      gatewayPreserved: true,
      authenticatedCatalogStillWorks: true,
      unsavedEditorPreserved: true,
    };
  } finally {
    if (!finished && child.exitCode === null) child.kill();
    await exited;
  }
});
