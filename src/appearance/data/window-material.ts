import type { Material } from "../model/transparency-preferences";

let applied: string | null = null;
let queue = Promise.resolve();

/**
 * Applies the native backdrop behind a transparent window. Tauri picks the first
 * effect the platform supports: Windows reads Acrylic/Mica, macOS the vibrancy
 * material. Linux has no native backdrop; the window stays plainly transparent.
 * `dark` follows the app theme, not the OS one, so Mica matches the surfaces.
 */
export function applyWindowMaterial(material: Material | "none", dark: boolean): Promise<void> {
  const key = `${material}:${dark}`;
  if (key === applied || !("__TAURI_INTERNALS__" in window)) {
    return queue;
  }
  applied = key;
  // Serialized: a slow call must never land after a newer one.
  queue = queue.then(async () => {
    try {
      const { getCurrentWindow, Effect } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      // Acrylic and Mica use different Windows APIs; clear first so they never stack.
      await win.clearEffects();
      if (material === "mica") {
        // Rust accepts these variants; the JS enum does not list them yet.
        const mica = (dark ? "micaDark" : "micaLight") as unknown as typeof Effect.Mica;
        await win.setEffects({ effects: [mica, Effect.UnderWindowBackground] });
      } else if (material === "blur") {
        // Near-zero tint: the app's own surfaces decide how dark the glass reads.
        const tint: [number, number, number, number] = dark ? [0, 0, 0, 1] : [255, 255, 255, 1];
        await win.setEffects({ effects: [Effect.Acrylic, Effect.HudWindow], color: tint });
      }
    } catch (error) {
      applied = null;
      console.warn("[transparency] window material unavailable", error);
    }
  });
  return queue;
}
