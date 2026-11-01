import { recordCrash, type CrashKind } from "./crash-store";

/** Log a caught failure unless the global invoke tracker already recorded it. */
export function catchLog(module: string, kind: CrashKind = "invoke") {
  return (e: unknown) => {
    if (e && typeof e === "object" && "__crashLogged" in e) {
      return;
    }
    recordCrash(module, kind, e instanceof Error ? e : new Error(String(e)));
  };
}
