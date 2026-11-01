import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "preact/hooks";

/** A subject string (older senders), or a subject with the project an app grant covers. */
type GrantedPayload = string | null | { subject?: string; projectId?: string | null };

function grantedScope(payload: GrantedPayload): { subject: string; projectId: string | null } {
  if (payload && typeof payload === "object") {
    return { subject: payload.subject || "files", projectId: payload.projectId ?? null };
  }
  return { subject: payload || "files", projectId: null };
}

export interface FilePermission {
  requestId: string;
  terminal: string;
  projectId: string;
  rootPath: string;
  path: string;
  /** "consent": the first file tool use from a terminal; "read": a path outside its project. */
  access: "read" | "consent";
  /** For "consent": "files", or "app:<id>" to run scripts in an application. */
  subject?: string;
  /** The application's name for an "app:" subject. */
  label?: string;
  /** For an "app:" subject: the script that raised the question (possibly shortened). */
  script?: string;
  directory: boolean;
  receivedAt: number;
}
export function useFilePermissions(
  scopes: { terminal: string; projectId: string; rootPath: string }[],
) {
  const [queue, setQueue] = useState<FilePermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const unlisten = listen<Omit<FilePermission, "receivedAt">>(
      "plugin-file-permission",
      ({ payload }) => {
        if (
          !active ||
          !payload ||
          (payload.access !== "read" && payload.access !== "consent") ||
          typeof payload.requestId !== "string"
        ) {
          return;
        }
        if (payload.access === "consent") {
          // Tells the waiting agent call that someone can answer.
          void invoke("plugin_file_request_seen", { requestId: payload.requestId }).catch(() => {});
        }
        setQueue((previous) =>
          previous.some((p) => p.requestId === payload.requestId)
            ? previous
            : [...previous, { ...payload, receivedAt: Date.now() }].slice(0, 16),
        );
      },
    );
    const revoke = listen<boolean>("plugin-file-access-changed", ({ payload }) => {
      if (active && !payload) {
        setQueue([]);
      }
    });
    // Always allowed (here or in Settings): the open first-use questions it covers are
    // answered. An application grant names its project and covers only that project.
    const granted = listen<GrantedPayload>("plugin-file-consent-granted", ({ payload }) => {
      if (active) {
        const { subject, projectId } = grantedScope(payload);
        setQueue((previous) =>
          previous.filter(
            (p) =>
              p.access !== "consent" ||
              (p.subject ?? "files") !== subject ||
              (projectId !== null && p.projectId !== projectId),
          ),
        );
      }
    });
    return () => {
      active = false;
      for (const pending of [unlisten, revoke, granted]) {
        void pending.then((stop) => stop()).catch(console.error);
      }
    };
  }, []);
  const serialized = JSON.stringify(scopes);
  useEffect(() => {
    const prune = () =>
      setQueue((previous) => {
        const next = previous.filter(
          (p) =>
            Date.now() - p.receivedAt < 60_000 &&
            scopes.some(
              (s) =>
                s.terminal === p.terminal &&
                s.projectId === p.projectId &&
                s.rootPath === p.rootPath,
            ),
        );
        return next.length === previous.length ? previous : next;
      });
    prune();
    const timer = setInterval(prune, 1000);
    return () => clearInterval(timer);
  }, [serialized]);
  const current = queue[0];
  useEffect(() => setError(""), [current?.requestId]);
  const reply = async (decision: "deny" | "file" | "folder" | "always" | "session") => {
    if (!current || busy) {
      return;
    }
    setBusy(true);
    try {
      if (current.access === "consent") {
        await invoke("plugin_file_consent_reply", { requestId: current.requestId, decision });
      } else {
        await invoke("plugin_file_permission_reply", { requestId: current.requestId, decision });
      }
      // A grant also answers the questions it covers natively; drop them here too.
      setQueue((previous) =>
        previous.filter(
          (p) =>
            p.requestId !== current.requestId &&
            !(
              current.access === "consent" &&
              p.access === "consent" &&
              (p.subject ?? "files") === (current.subject ?? "files") &&
              decision !== "deny" &&
              (decision === "always" || p.terminal === current.terminal)
            ),
        ),
      );
    } catch (cause) {
      if (decision === "deny") {
        setQueue((previous) => previous.filter((p) => p.requestId !== current.requestId));
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  };
  return { current, busy, error, reply };
}
