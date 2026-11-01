import { invoke } from "@tauri-apps/api/core";
import type { AiService } from "./ai-services";

export interface UsageWindow {
  kind: "session" | "weekly";
  label: string;
  usedPercent: number;
  /** Unix seconds, when the CLI reports an exact reset time. */
  resetsAt: number | null;
  /** Reset time as the CLI phrased it, when no timestamp is available. */
  resetsText: string | null;
}

export interface UsageReport {
  id: AiService["id"];
  name: string;
  plan: string | null;
  windows: UsageWindow[];
  error: string | null;
  /** Unix seconds when the limits were last seen, when they are not read live. */
  updatedAt: number | null;
  /** Why no limits are shown, when that is expected rather than an error. */
  note: string | null;
  /** A block the windows alone do not show, such as a spend limit. */
  warning: string | null;
}

/** Plans and quota of signed-in subscriptions; no query spends model quota. */
export const readAiUsage = () => invoke<UsageReport[]>("read_ai_usage");

export function resetLabel(window: UsageWindow, now = Date.now()): string | null {
  if (window.resetsAt !== null) {
    const minutes = Math.max(0, Math.round((window.resetsAt * 1000 - now) / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const parts =
      days > 0
        ? [`${days}d`, `${hours}h`]
        : hours > 0
          ? [`${hours}h`, `${minutes % 60}m`]
          : [`${minutes}m`];
    return `Resets in ${parts.join(" ")}`;
  }
  if (window.resetsText) {
    // Claude appends the account time zone, e.g. "Oct 16, 12:39am (America/Caracas)".
    return `Resets ${window.resetsText.replace(/\s*\([^)]*\)\s*$/, "")}`;
  }
  return null;
}

/** "Last seen 11:48 in Claude Code" for limits saved from a CLI session. */
export function lastSeenLabel(report: UsageReport): string | null {
  if (!report.updatedAt) {
    return null;
  }
  const at = new Date(report.updatedAt * 1000);
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const when = sameDay
    ? time
    : `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  return `Last seen ${when} in ${report.name}`;
}
