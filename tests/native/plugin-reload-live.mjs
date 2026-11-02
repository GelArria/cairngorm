// Opt-in Windows acceptance against deployed tldraw; only the isolated QA child is closed.
// CDP is intentional: TesterArmy's persistent-context setup navigates to about:blank,
// which the native app's navigation guard rejects (see tests/README.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { withQaProfile, waitFor } from "./qa-profile.mjs";

await withQaProfile("tldraw-reload", async (qa) => {
  const page = await qa.start();
  const onboarding = page.getByRole("dialog", { name: "Set up the Cairngorm agent" });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: "Close", exact: true }).click();
  await qa.invoke("plugins_connect_agents");
  await qa.invoke("plugins_set_enabled", { id: "tldraw", enabled: true });
  const configPath = path.join(qa.scratch, "client.json");
  fs.writeFileSync(configPath, "{}");
  const state = await qa.invoke("plugins_add_client", {
    name: "Tldraw reload QA",
    configPath,
    format: "json",
  });
  const client = state.clients[0].id;
  await qa.invoke("plugins_set_client_connected", { id: client, enabled: true });
  await page.getByRole("button", { name: "New terminal", exact: true }).first().click();
  await page
    .getByRole("menuitem", { name: /PowerShell|Default shell/i })
    .first()
    .click();
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  const source = await page.locator("[data-pane-id]").getAttribute("data-pane-id");
  const session = await waitFor(async () => {
    const rows = await qa.invoke("plugin:sql|select", {
      db: "sqlite:panel.db",
      query: "SELECT value FROM terminal_state WHERE key = ?",
      values: ["cairngorm-terminal-workspace-v1"],
    });
    return (
      rows.length && JSON.parse(rows[0].value).state.tabs.find((t) => t.id === source)?.sessionId
    );
  }, "Source terminal was not persisted");
  const data = path.join(qa.scratch, "AppData/Roaming/dev.cairngorm.fresh-profile");
  const run = async (name, args) => {
    const commandPath = path.join(qa.scratch, `${name}-command.json`);
    const output = path.join(qa.scratch, `${name}-result.json`);
    fs.writeFileSync(
      commandPath,
      JSON.stringify({
        bridge: path.join(data, "plugins/mcp-bridge.cjs"),
        client,
        tool: "tldraw_exec",
        arguments: args,
        output,
      }),
    );
    const quote = (s) => "'" + s.replace(/'/g, "''") + "'";
    await qa.invoke("pty_write", {
      sessionId: session,
      data: `& ${quote(process.execPath)} ${quote(path.resolve("tests/mocks/native-plugin-driver.cjs"))} ${quote(commandPath)}\r`,
    });
    await waitFor(() => fs.existsSync(output), "MCP call did not finish", 65000);
    const reply = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(reply.error, undefined);
    assert.notEqual(reply.result?.isError, true);
    return reply.result;
  };
  const result = await run("create", {
    code: "editor.createShape({_type:'rectangle',shapeId:'qa-one',x:80,y:80,w:300,h:160,text:'Before reload'}); editor.createShape({_type:'rectangle',shapeId:'qa-two',x:450,y:80,w:300,h:160,text:'Second shape'}); editor.zoomToFit();",
  });
  const canvasId = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .match(/Canvas ID: ([\w-]+)/)?.[1];
  assert.equal(typeof canvasId, "string");
  const frame = page.frameLocator('[data-testid="plugin-view-frame"]');
  const first = frame.locator('[data-shape-id="shape:qa-one"]');
  const second = frame.locator('[data-shape-id="shape:qa-two"]');
  await expect(first).toBeVisible();
  await expect(second).toContainText("Second shape");
  await expect(page.getByRole("button", { name: "Reload view", exact: true })).toBeEnabled();
  await first.dblclick();
  const editable = frame.locator('[contenteditable="true"]');
  await expect(editable).toHaveCount(1);
  await editable.fill("Saved manual edit Ω");
  await editable.press("Escape");
  await page.screenshot({ path: path.join(qa.scratch, "before-reload.png") });
  // Reload repeatedly: no stale exec result/input may replace the latest manual edit.
  for (let i = 0; i < 3; i++) {
    const old = await page.locator('[data-testid="plugin-view-frame"]').elementHandle();
    await page.getByRole("button", { name: "Reload view", exact: true }).click();
    await expect.poll(() => old.evaluate((e) => e.isConnected)).toBe(false);
    await expect(page.getByRole("button", { name: "Reload view", exact: true })).toBeEnabled();
    await expect(first).toBeVisible();
    await expect(first).toContainText("Saved manual edit Ω");
    await expect(second).toContainText("Second shape");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await old.dispose();
  }
  // A new call against this canvas must also preserve the acknowledged edit.
  await run("reopen", { canvasId, code: "editor.zoomToFit();" });
  await expect(first).toBeVisible();
  await expect(first).toContainText("Saved manual edit Ω");
  await expect(second).toContainText("Second shape");
  await expect(page.getByRole("button", { name: "Reload view", exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(qa.scratch, "after-reload.png") });
  await qa.invoke("pty_write", {
    sessionId: session,
    data: "Write-Output ('QA terminal ' + 'alive')\r",
  });
  await waitFor(async () => {
    const replay = await qa.invoke("pty_replay", { sessionId: session });
    return replay && Buffer.from(replay.data, "base64").toString().includes("QA terminal alive");
  }, "Source terminal did not respond");
  return {
    native: true,
    deployedTldraw: true,
    reloads: 3,
    manualEditPreserved: true,
    shapeIdsPreserved: true,
    sameCanvasReopened: true,
    sourceTerminalAlive: true,
  };
});
