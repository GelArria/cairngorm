import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { FileAccess, PluginsState } from "../model/types";

export function usePlugins(open: boolean) {
  const [state, setState] = useState<PluginsState | null>(null);
  // The plugin being added or removed, and which way: adding an OAuth plugin signs in.
  const [busy, setBusy] = useState<{ id: string; enabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A null id connects existing plugins without adding another one.
  const [connection, setConnection] = useState<{
    id: string | null;
    files?: FileAccess;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let live = true;
    const load = () =>
      invoke<PluginsState>("plugins_state")
        .then((next) => live && setState(next))
        .catch((e) => live && setError(errorMessage(e)));
    void load();
    // Agents start and stop while Settings is open: keep "Active" and "Seen" current.
    const timer = window.setInterval(() => void load(), 15_000);
    // "Always allow" chosen in a file dialog changes File access while Settings is open.
    const granted = listen("plugin-file-consent-granted", () => void load());
    return () => {
      live = false;
      window.clearInterval(timer);
      void granted.then((stop) => stop()).catch(console.error);
    };
  }, [open]);

  // Adding an OAuth plugin waits for the browser sign-in, so this may take minutes.
  const apply = useCallback(
    async (
      id: string | null,
      enabled: boolean,
      connect = false,
      files: FileAccess | null = null,
    ) => {
      setBusy({ id: files ? "file-access" : (id ?? "connect-agents"), enabled });
      setError(null);
      try {
        if (connect) {
          const connected = await invoke<PluginsState>("plugins_connect_agents");
          setState(connected);
          if (connected.error) {
            setError(connected.error);
            return;
          }
        }
        if (files) {
          const next = await invoke<PluginsState>("plugins_set_files_access", { access: files });
          setState(next);
          setError(next.error);
        } else if (id !== null) {
          const next = await invoke<PluginsState>("plugins_set_enabled", { id, enabled });
          setState(next);
          setError(next.error);
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const setEnabled = (id: string, enabled: boolean) => {
    if (!state || busy) {
      return;
    }
    if (enabled && !state.agentsConnected) {
      setConnection({ id });
      return;
    }
    void apply(id, enabled);
  };

  const confirmConnection = () => {
    if (!connection) {
      return;
    }
    const { id, files } = connection;
    setConnection(null);
    void apply(id, true, true, files);
  };

  useEffect(() => {
    if (!open) {
      setConnection(null);
    }
  }, [open]);

  // The pending setEnabled call then returns on its own and clears `busy`.
  const cancelSignIn = useCallback(() => {
    void invoke("plugins_cancel_sign_in").catch((e) => setError(errorMessage(e)));
  }, []);

  return {
    state,
    acceptState: setState,
    busy,
    error,
    setEnabled,
    setFilesAccess: (access: FileAccess) => {
      if (!state || busy) {
        return;
      }
      if (access !== "off" && !state.agentsConnected) {
        setConnection({ id: null, files: access });
      } else {
        void apply(null, access !== "off", false, access);
      }
    },
    cancelSignIn,
    connection,
    connectAgents: () => {
      if (state?.agentsConnected) {
        void apply(null, true, true);
      } else {
        setConnection({ id: null });
      }
    },
    cancelConnection: () => setConnection(null),
    confirmConnection,
  };
}
