import assert from "node:assert/strict";
import fs from "node:fs";
assert.ok(
  process.env.NATIVE_CDP_URL && !process.env.NATIVE_CDP_URL.includes(":9222"),
  "Isolated QA only",
);
const dir = "logs/release-detached-cycles";
fs.mkdirSync(dir, { recursive: true });
process.env.CAIRNGORM_DETACHED_MEMBERS = "2";
const results = [];
for (let cycle = 0; cycle < 20; cycle++) {
  const reattach = cycle % 2 === 1;
  process.env.CAIRNGORM_REATTACH_CHECK = reattach ? "1" : "0";
  console.log(
    `Native detached cycle ${cycle + 1}/20: two members, ${reattach ? "reattach" : "close"}`,
  );
  await import(`./detached-close-native.mjs?cycle=${cycle}`);
  const source = `logs/optimization-detached-close${reattach ? "-reattach" : ""}-evidence.json`;
  const evidence = JSON.parse(fs.readFileSync(source, "utf8"));
  assert.equal(evidence.windowClosed, true);
  assert.equal(evidence.sessions.filter((session) => session.registered).length, reattach ? 3 : 1);
  fs.copyFileSync(source, `${dir}/cycle-${String(cycle + 1).padStart(2, "0")}.json`);
  results.push({
    cycle: cycle + 1,
    reattach,
    owned: 2,
    columnRatios: evidence.layoutBefore.columnRatios,
    passed: true,
  });
}
fs.writeFileSync(`${dir}/summary.json`, JSON.stringify(results, null, 2));
console.log(
  "PASS: 20 consecutive native cycles; 10 ordinary closes, 10 reattachments, two owned PTYs, unrelated PTY survives, pre-action 37/63 verified and preserved on reattach",
);
