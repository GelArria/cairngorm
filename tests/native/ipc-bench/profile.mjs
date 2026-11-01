import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function selfTimes(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const times = { testMonitorMs: 0, xtermMs: 0, harnessAndDecodeMs: 0, otherMs: 0 };
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    let id = profile.samples[i],
      category = "otherMs";
    while (id != null) {
      const url = nodes.get(id)?.callFrame.url ?? "";
      if (url.includes("/src/testing/")) {
        category = "testMonitorMs";
        break;
      }
      if (url.includes("@xterm")) {
        category = "xtermMs";
        break;
      }
      if (url.includes("ipc-bench/suite.js")) category = "harnessAndDecodeMs";
      id = parents.get(id);
    }
    times[category] += (profile.timeDeltas[i] ?? 0) / 1000;
  }
  return times;
}

export async function profileNative(page, out, mib, goldenScreenHash) {
  const directory = path.join(out, "profiles");
  mkdirSync(directory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  const samples = [];
  try {
    for (let round = 0; round < 3; round++)
      for (const scenario of ["transport", "xterm", "xterm-monitor"]) {
        await cdp.send("Profiler.start");
        const result = await page.evaluate((options) => window.runBenchCase(options), {
          mode: "coalesced",
          sessions: 4,
          bytes: mib * 1048576,
          render: scenario !== "transport",
          monitor: scenario === "xterm-monitor",
          verify: false,
        });
        const { profile } = await cdp.send("Profiler.stop");
        if (result.render && result.screenHash !== goldenScreenHash)
          throw new Error("Profiling changed the xterm screen");
        writeFileSync(
          path.join(directory, `${scenario}-${round}.cpuprofile`),
          JSON.stringify(profile),
        );
        samples.push({ round, scenario, ...result, ...selfTimes(profile) });
      }
  } finally {
    await cdp.detach();
  }
  writeFileSync(path.join(out, "profiles.json"), JSON.stringify(samples, null, 2));
  return samples;
}
