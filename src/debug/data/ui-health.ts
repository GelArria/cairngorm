// UI health monitor — detects freezes that don't affect timers.
// Once a second it asks for one animation frame; a frame that has not arrived after
// STUCK_THRESHOLD_MS while timers still run means rendering stopped. A permanent
// requestAnimationFrame loop would do the same but keeps the compositor producing a
// frame on every display refresh, which costs CPU and GPU even when nothing changes.

let _pendingSince = 0;
let _lastPing = 0;
let _stuck = false;
let _initialized = false;
let _rafId = 0;
let _frameInterval: ReturnType<typeof setInterval> | null = null;
let _pingInterval: ReturnType<typeof setInterval> | null = null;
const STUCK_THRESHOLD_MS = 10000;
const FRAME_PROBE_MS = 1000;

function frameArrived() {
  const waited = performance.now() - _pendingSince;
  _pendingSince = 0;
  _rafId = 0;
  if (waited > STUCK_THRESHOLD_MS) {
    console.error(`[ui-health] UI frozen for ${Math.round(waited)}ms — no frame rendered`);
  }
  _stuck = false;
}

function probeFrame() {
  // Hidden documents get no frames by design; restart the probe when shown again.
  if (document.hidden) {
    cancelAnimationFrame(_rafId);
    _rafId = 0;
    _pendingSince = 0;
    return;
  }
  const now = performance.now();
  if (_pendingSince === 0) {
    _pendingSince = now;
    _rafId = requestAnimationFrame(frameArrived);
  } else if (now - _pendingSince > STUCK_THRESHOLD_MS && !_stuck) {
    _stuck = true;
    console.error(
      `[ui-health] No frame rendered for ${Math.round(now - _pendingSince)}ms while timers run`,
    );
  }
}

function checkPing() {
  const now = Date.now();
  if (_lastPing > 0 && now - _lastPing > STUCK_THRESHOLD_MS) {
    // Rust watchdog hasn't received pong in 10s
    // This means webview event loop is stuck (can't process events)
    if (!_stuck) {
      console.error(
        `[ui-health] Webview event loop stuck — no pong response for ${Math.round(now - _lastPing)}ms`,
      );
      _stuck = true;
    }
  }
}

export function initUiHealth(): void {
  if (_initialized) {
    return;
  }
  _initialized = true;
  _frameInterval = setInterval(probeFrame, FRAME_PROBE_MS);

  // Listen for watchdog pings from Rust — respond via invoke (more reliable than emit)
  (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      _lastPing = Date.now();

      await listen("watchdog-ping", () => {
        _lastPing = Date.now();
        invoke("pong").catch(() => {
          /* watchdog may be gone */
        });
      });

      // Periodic check
      _pingInterval = setInterval(checkPing, 2000);
    } catch {
      /* not in Tauri */
    }
  })();
}

export function stopUiHealth(): void {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
  }
  _rafId = 0;
  _pendingSince = 0;
  _stuck = false;
  if (_frameInterval) {
    clearInterval(_frameInterval);
    _frameInterval = null;
  }
  if (_pingInterval) {
    clearInterval(_pingInterval);
    _pingInterval = null;
  }
  _initialized = false;
}

export function isUiStuck(): boolean {
  return _stuck;
}
