type Handler = (event: { event: string; id: number; payload: any }) => void;
const handlers = new Map<string, Set<Handler>>();

export async function listen<T>(
  event: string,
  handler: (event: { event: string; id: number; payload: T }) => void,
) {
  const listeners = handlers.get(event) ?? new Set<Handler>();
  handlers.set(event, listeners);
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (!listeners.size) handlers.delete(event);
  };
}
export async function once<T>(
  event: string,
  handler: (event: { event: string; id: number; payload: T }) => void,
) {
  const unlisten = await listen<T>(event, (value) => {
    unlisten();
    handler(value);
  });
  return unlisten;
}
export async function emit(event: string, payload?: unknown) {
  [...(handlers.get(event) ?? [])].forEach((handler) => handler({ event, id: 0, payload }));
}
export async function emitTo(_target: unknown, event: string, payload?: unknown) {
  await emit(event, payload);
}
