export function homeDir(): Promise<string> {
  const h = (window as any).__TAURI_HOME__;
  return Promise.resolve(h ?? "C:\\Users\\TestUser");
}

export function join(...segments: string[]): Promise<string> {
  return Promise.resolve(segments.join("\\"));
}

export function appDir(): Promise<string> {
  return homeDir();
}
