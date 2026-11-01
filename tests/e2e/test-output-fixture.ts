import type { Page } from "@playwright/test";

export async function send(app: Page, event: string, payload: unknown) {
  await app.evaluate(
    async ({ event, payload }) => {
      if (event.startsWith("pty-exit-")) {
        const backend = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
        await backend.finish(event.slice("pty-exit-".length));
      }
      const events = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await events.emit(event, payload);
    },
    { event, payload },
  );
}
export async function output(app: Page, sessionId: string, text: string) {
  await app.evaluate(
    async ({ sessionId, text }) => {
      const backend = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
      await backend.output(sessionId, text);
    },
    { sessionId, text },
  );
}
