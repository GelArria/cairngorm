# Patched tao 0.35.0

Unmodified [tao 0.35.0](https://crates.io/crates/tao/0.35.0) from crates.io, Apache-2.0/MIT
(license files included), except for one change on Windows:

- `src/platform_impl/windows/event_loop/runner.rs`: `EventLoopRunnerShared` is
  `Arc<EventLoopRunner>` instead of `Rc<EventLoopRunner>`.
- `src/platform_impl/windows/event_loop.rs`: the runner is created with `Arc::new`.

## Why

`tauri-runtime-wry` keeps tao's `EventLoopWindowTarget` inside a `Clone + Send + Sync`
context, so every `AppHandle`, window or webview clone or drop touches the runner's
reference count on whatever thread does it. With `Rc` that count is not atomic: under
load (several terminals streaming output) the main thread and PTY/tokio threads race,
the runner is freed while in use and Windows stops the app with `0xc0000374` (heap
corruption). Reproduced in 4 of 4 runs with `tests/native/resource-baseline.mjs`-style
load and captured with cdb: the fault is in `Rc::drop_slow` while dropping an
`AppHandle` on the main thread. Upstream: tauri-apps/tauri#15793 and #15408.

## Updating

When Tauri or tao is upgraded, check whether upstream switched to an atomic count. If
not, re-apply the two-line change to the matching tao version and keep this note; if
so, delete this folder and the `[patch.crates-io]` entry in `src-tauri/Cargo.toml`.
Cargo ignores the patch (with a warning) if the locked tao version no longer matches.
