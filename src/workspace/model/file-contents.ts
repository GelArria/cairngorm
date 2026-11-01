export function getExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) {
    return "";
  }
  return (parts[parts.length - 1] ?? "").toLowerCase();
}
