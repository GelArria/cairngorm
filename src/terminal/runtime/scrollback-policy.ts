import { execute } from "@/common/storage/db";
import { configureCrashPersistence } from "@/debug/data/crash-store";
import { invoke } from "@tauri-apps/api/core";
import { nativeStorageAvailable } from "../data/native-storage";

let policy = { persistScrollback: true, retentionDays: 7 };
export const scrollbackPolicy = () => policy;

export async function initializeScrollbackPolicy(): Promise<void> {
  try {
    const value = await invoke<typeof policy>("get_data_policy");
    if (!value || typeof value.persistScrollback !== "boolean") {
      throw new Error("Native data policy is unavailable");
    }
    policy = {
      persistScrollback: value.persistScrollback,
      retentionDays: Math.max(1, value.retentionDays || 7),
    };
    configureCrashPersistence(policy);
    if (nativeStorageAvailable()) {
      if (!policy.persistScrollback) {
        await execute("DELETE FROM terminal_state WHERE key LIKE 'panel-scrollback:%'");
      } else {
        await execute(
          "DELETE FROM terminal_state WHERE key LIKE 'panel-scrollback:%' AND updated_at < ?",
          [Date.now() - policy.retentionDays * 86400000],
        );
      }
    }
    for (const key of Object.keys(localStorage)) {
      if (policy.persistScrollback && (key.endsWith(":retained-at") || key.endsWith(":saved-at"))) {
        continue;
      }
      if (
        key.startsWith("panel-scrollback:") &&
        (!policy.persistScrollback || !localStorage.getItem(`${key}:retained-at`))
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    // Do not persist new terminal output if native policy could not be loaded.
    policy.persistScrollback = false;
    configureCrashPersistence(policy);
    console.warn("[privacy] terminal history persistence disabled: policy unavailable", error);
  }
}
