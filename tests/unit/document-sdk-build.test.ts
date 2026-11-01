import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, it } from "vitest";

it("keeps the served SDK and the sample provider compiled from their TypeScript sources", () => {
  // Throws with the stale file list when someone edits the .ts without regenerating.
  execFileSync(process.execPath, ["scripts/build-document-sdk.mjs", "--check"], { stdio: "pipe" });
}, 60000);

it("ships a sample provider whose manifest declares only supported capabilities", () => {
  const manifest = JSON.parse(
    fs.readFileSync("src/documents/sdk/sample-provider/cairngorm-provider.json", "utf8"),
  );
  expect(manifest).toMatchObject({
    protocol: "cairngorm.document-provider/1",
    capabilities: ["view", "edit"],
    entry: "index.html",
  });
  const main = fs.readFileSync("src/documents/sdk/sample-provider/main.js", "utf8");
  expect(main).toContain('from "./_cairngorm/document-sdk.js"');
  expect(main).not.toMatch(/innerHTML|fetch\(|__TAURI/);
});
