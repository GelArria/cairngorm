import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { startTelemetry } from "./telemetry.js";
import { TerminalLines } from "../../../src/testing/model/terminal-lines.ts";
import { TestTracker } from "../../../src/testing/model/test-tracker.ts";

const pattern = new TextEncoder().encode("\x1b[32mCairngorm 🦀 IPC stream fixture \x1b[0m\r\n");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = document.querySelector("#status");

async function runCase(mode, sessions, bytes, render, monitor = false, verify = true) {
  document.querySelector("#terminals").replaceChildren();
  const terminals = [],
    serializers = [],
    received = Array(sessions).fill(0),
    counts = Array(sessions).fill(0);
  let observedLines = 0;
  const lines = Array.from({ length: sessions }, (_, sid) => {
    const tracker = new TestTracker(`bench-${sid}`, () => {});
    return new TerminalLines((line, redraw) => {
      observedLines++;
      tracker.line(line, redraw);
    });
  });
  if (render)
    for (let i = 0; i < sessions; i++) {
      const host = document.createElement("div");
      host.className = "terminal";
      document.querySelector("#terminals").append(host);
      const term = new Terminal({ cols: 72, rows: 14, scrollback: 2000, cursorBlink: false });
      const serializer = new SerializeAddon();
      term.loadAddon(serializer);
      term.open(host);
      terminals.push(term);
      serializers.push(serializer);
    }
  const unlisten = [],
    channels = [],
    ended = new Set();
  let resolve, reject, timeout;
  const complete = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  complete.catch(() => {}); // A bad stream may arrive before the command reply.
  const accept = (sid, data) => {
    counts[sid]++;
    const offset = received[sid];
    for (let i = 0; verify && i < data.length; i++) {
      if (data[i] !== pattern[(offset + i) % pattern.length]) {
        reject(new Error(`Byte mismatch: ${mode}, session ${sid}, offset ${offset + i}`));
        return;
      }
    }
    received[sid] += data.length;
    if (received[sid] > bytes) {
      reject(new Error("Duplicate output"));
      return;
    }
    terminals[sid]?.write(data);
  };
  const finish = (sid) => {
    if (ended.has(sid)) {
      reject(new Error("Duplicate EOF"));
      return;
    }
    if (received[sid] !== bytes) {
      reject(new Error(`EOF before all bytes: ${mode}, ${received[sid]}/${bytes}`));
      return;
    }
    if (monitor) lines[sid].flush();
    ended.add(sid);
    if (ended.size === sessions) resolve();
  };
  for (let sid = 0; sid < sessions; sid++) {
    if (mode.startsWith("raw"))
      channels.push(
        new Channel((body) => {
          const data = new Uint8Array(body);
          if (data.length) {
            accept(sid, data);
            if (monitor) lines[sid].push(data);
          } else finish(sid);
        }),
      );
    else {
      unlisten.push(
        await listen(`bench-data-${sid}`, (event) => {
          const binary = atob(event.payload.data),
            data = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
          accept(sid, data);
          // Match App's independent test monitor: a second decode and parser.
          if (monitor) {
            const observed = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) observed[i] = binary.charCodeAt(i);
            lines[sid].push(observed);
          }
        }),
      );
      unlisten.push(await listen(`bench-exit-${sid}`, () => finish(sid)));
    }
  }
  await wait(150);
  const stopTelemetry = startTelemetry(),
    start = performance.now();
  try {
    timeout = setTimeout(() => reject(new Error(`Native ${mode} timed out`)), 60_000);
    await invoke("bench_stream", { mode, sessions, bytes, channels });
    await complete;
    const receivedMs = performance.now() - start;
    await Promise.all(
      terminals.map((term) => new Promise((ok) => term.write(new Uint8Array(0), ok))),
    );
    const drainedMs = performance.now() - start;
    const serialized = serializers.map((s) => s.serialize()).join("\n---\n");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return {
      mode,
      sessions,
      render,
      monitor,
      verify,
      observedLines,
      bytes: received.reduce((a, b) => a + b, 0),
      callbacks: counts.reduce((a, b) => a + b, 0),
      receivedMs,
      drainedMs,
      mibPerSec: (sessions * bytes) / 1048576 / (drainedMs / 1000),
      screenHash: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""),
      ...(await stopTelemetry()),
    };
  } finally {
    clearTimeout(timeout);
    await stopTelemetry();
    for (const off of unlisten) off();
    for (const term of terminals) term.dispose();
  }
}

window.runBenchSuite = async ({ rounds = 3, mib = 2 } = {}) => {
  const modes = ["events", "coalesced", "raw", "raw-batch"],
    results = [],
    hashes = new Map();
  for (const mode of modes) await runCase(mode, 1, 256 * 1024, false);
  for (let round = 0; round < rounds; round++) {
    for (const render of [false, true])
      for (const sessions of [1, 4]) {
        // Rotate order so warm-up/thermal effects don't always favour one mode.
        for (let i = 0; i < modes.length; i++) {
          const mode = modes[(i + round) % modes.length];
          status.textContent = `Round ${round + 1}/${rounds}: ${mode}, ${sessions} sessions, xterm=${render}`;
          const result = { round, ...(await runCase(mode, sessions, mib * 1048576, render)) };
          const key = `${sessions}/${render}`;
          if (hashes.has(key) && hashes.get(key) !== result.screenHash)
            throw new Error(`xterm screen changed for ${mode}`);
          hashes.set(key, result.screenHash);
          results.push(result);
          console.log("[IPC-BENCH]", JSON.stringify(result));
          await wait(250);
        }
      }
  }
  status.textContent = `PASSED: ${results.length} runs; exact bytes, ordered EOF and identical xterm screens`;
  return {
    results,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    patternBytes: pattern.length,
  };
};
window.runBenchCase = ({ mode, sessions, bytes, render, monitor = false, verify = true }) =>
  runCase(mode, sessions, bytes, render, monitor, verify);
status.textContent = "Ready — controlled by tests/native/ipc-bench/run.mjs";
window.__IPC_BENCH_READY__ = true;
