# Native IPC / terminal benchmark

```bash
node tests/native/ipc-bench/run.mjs 3 2
```

Requires Windows/WebView2 for the measured configuration, installed Cargo dependencies, Vite and Playwright from this repo. No app dependencies are added. The runner builds an isolated Tauri executable in release, serves this page on **1432**, connects only to its CDP on **9333**, and cleans up its own process/server. It does not launch the Cairngorm UI, open its database, load credentials, start PTYs or alter the installed app. Occupied ports fail rather than attaching to another app.

The production `PtyOutput` module and emitter helper from `pty.rs` are compiled verbatim; the runner fails if it cannot locate the helper. The baseline mirrors the former per-read base64 event emission. Raw Channels are experimental comparisons, **not** a production implementation; their fixed batching has no credit-based renderer backpressure.

| Mode        | Payload / dispatch                                                  |
| ----------- | ------------------------------------------------------------------- |
| `events`    | 4 KiB reads, one main-thread event per read                         |
| `coalesced` | Production 64 KiB bounded coalescer, same event shape               |
| `raw`       | 4 KiB `Channel<Response>` raw bodies, dispatched on the main thread |
| `raw-batch` | Fixed 64 KiB raw Channel bodies, dispatched on the main thread      |

Three rotated-order rounds × four modes × one/four sessions × xterm on/off = **48 runs**. Each validates every byte, exact byte count, ordered EOF and identical serialized xterm buffers. Control ping round-trips and rAF gaps are measured, not inferred from Rust timings.

A further **nine CDP CPU profiles** compare transport, xterm, and xterm plus the actual `TerminalLines`/`TestTracker` monitor. Profiling skips the artificial byte-validation loop (the matrix already checks it); byte count, EOF and the golden xterm hash are still checked. The monitor gets ordinary ANSI/Unicode output, with no tests active: its publisher is a no-op, so the profile excludes test-result UI updates.

All results, generated Cargo project, logs and `.cpuprofile` files live in `logs/rust-performance/native-ipc/`. Profile figures are sampling-based estimates, not hardware CPU counters. This isolates native transport and selected consumers; it is **not** a whole-Cairngorm FPS, memory or startup benchmark. OS PTY reads, app plugins, detached windows, GPU addons and monitor behaviour during actual test runs are not measured.
