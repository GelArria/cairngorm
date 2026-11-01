import { isImageExtension } from "@/common/filesystem/file-kinds";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function clipboardImageName(file: File): string {
  if (file.name) {
    return file.name;
  }
  const ext = file.type.split("/")[1] ?? "png";
  return `clipboard-image-${Date.now()}.${ext}`;
}

export interface ClipboardFileResult {
  name: string;
  ext: string;
  content: string;
  imageSrc?: string;
  isImage: boolean;
}

export async function processClipboardFile(file: File): Promise<ClipboardFileResult> {
  const name = clipboardImageName(file);
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  const isImage = isImageExtension(ext) || file.type.startsWith("image/");

  if (isImage) {
    const imageSrc = await fileToDataUrl(file);
    return { name, ext, content: "", imageSrc, isImage: true };
  }

  const textExts = new Set([
    "json",
    "md",
    "markdown",
    "yaml",
    "yml",
    "ts",
    "tsx",
    "js",
    "jsx",
    "css",
    "html",
    "py",
    "rs",
    "sql",
    "sh",
    "toml",
    "xml",
    "csv",
    "tsv",
    "log",
    "cfg",
    "ini",
    "env",
    "txt",
    "ipynb",
  ]);
  const isText = file.type.startsWith("text/") || textExts.has(ext);
  const content = isText
    ? await file.text()
    : `[Binary: ${name} (${(file.size / 1024).toFixed(1)}KB)]`;
  return { name, ext, content, isImage: false };
}
