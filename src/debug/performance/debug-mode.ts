let _debug: boolean | null = null;

export async function detectDebugMode(): Promise<boolean> {
  if (_debug !== null) {
    return _debug;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    _debug = await invoke<boolean>("is_debug");
  } catch {
    // Fallback: Vite dev mode
    _debug = !!(import.meta as any).env?.DEV;
  }
  return _debug;
}

export function isDebug(): boolean {
  return _debug ?? false;
}
