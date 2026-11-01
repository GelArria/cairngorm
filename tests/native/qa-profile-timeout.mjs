// Self-check: a never-resolving evaluation still closes only the QA child.
import assert from "node:assert/strict";
import { withQaProfile, within } from "./qa-profile.mjs";

let pid;
await assert.rejects(
  withQaProfile("qa-timeout", async (qa) => {
    await qa.start();
    pid = qa.pid;
    await within(
      qa.page.evaluate(() => new Promise(() => {})),
      100,
      "Intentional QA deadline",
    );
  }),
  /Intentional QA deadline/,
);
assert(pid, "The QA child must actually have started");
assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
console.log("PASS: a pending native evaluation reaches owned-child cleanup");
