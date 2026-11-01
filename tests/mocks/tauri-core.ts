// Mock modules for @tauri-apps packages when running in browser (e2e tests)
// This file is aliased via vite.config.ts when E2E_TEST=true

export const invoke = (cmd: string, args: Record<string, unknown>, options?: unknown) => {
  if (cmd === "emit_terminal_event")
    return import("./tauri-event").then((events) =>
      args.target
        ? events.emitTo(args.target, String(args.event), args.payload)
        : events.emit(String(args.event), args.payload),
    );
  const fn = (window as any).__TAURI_INTERNALS__?.invoke;
  if (!fn) return Promise.reject(new Error("Tauri mock not available"));
  return fn(cmd, args, options);
};

export function convertFileSrc(p: string) {
  return p;
}
export function isTauri() {
  return false;
}
