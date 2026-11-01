// Every project is a gemstone: the Cairngorm gem drawn in its stone's colour
// over a dark facet-lit backdrop (default stone picked from the project id),
// or the user's own image from disk.
import { readFileAsDataURL } from "@/common/filesystem/fs-bridge";

const imageCache = new Map<string, string>();
// Bumped by forgetBackgroundImage: the same path re-picked must reload everywhere
let imageVersion = 0;
const versionListeners = new Set<() => void>();
const MAX_SIDE = 640;

/** Shrink once (a 12 MP photo → ~50 KB JPEG): tiles never hold the full file. */
async function downscale(dataUrl: string): Promise<string> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

/** Re-picking an edited file at the same path must show the new picture. */
export function forgetBackgroundImage(path: string) {
  imageCache.delete(path);
  imageVersion++;
  versionListeners.forEach((l) => l());
}

export const getCachedBackgroundImage = (path: string) => imageCache.get(path) ?? null;
export const getBackgroundImageVersion = () => imageVersion;

export function subscribeBackgroundImages(listener: () => void) {
  versionListeners.add(listener);
  return () => {
    versionListeners.delete(listener);
  };
}

export async function loadBackgroundImage(path: string): Promise<string> {
  const url = await downscale(await readFileAsDataURL(path));
  imageCache.set(path, url);
  return url;
}
