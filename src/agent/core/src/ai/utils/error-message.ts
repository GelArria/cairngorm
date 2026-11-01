/** The sidecar owns its dependencies and cannot import the frontend package. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
