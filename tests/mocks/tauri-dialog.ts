// E2E: a spec can preset the folder/file the "picker" returns via window.__E2E_PICK__.
export function open() {
  return Promise.resolve((window as any).__E2E_PICK__ ?? null);
}
export function save() {
  return Promise.resolve(null);
}
