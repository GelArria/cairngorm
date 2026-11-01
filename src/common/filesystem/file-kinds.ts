const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "avif",
]);

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ""));
}

export const NOTEBOOK_EXTENSIONS = new Set(["ipynb"]);

export const TEXT_EXTENSIONS = new Set(["md", "markdown"]);
