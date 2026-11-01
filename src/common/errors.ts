/** Preserve an Error's message and provide readable text for non-Error rejections. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
