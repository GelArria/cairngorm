import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";
import type { ClientFormat, PluginsState } from "../model/types";

export function usePluginClients(onState: (state: PluginsState) => void) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [format, setFormat] = useState<ClientFormat>("json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const perform = async (command: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<PluginsState>(command, args);
      onState(next);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "MCP configuration", extensions: ["json", "jsonc", "toml"] }],
      });
      if (typeof selected === "string") {
        setPath(selected);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const add = async (event: Event) => {
    event.preventDefault();
    if (await perform("plugins_add_client", { name: name.trim(), configPath: path, format })) {
      setOpen(false);
    }
  };
  const connect = (id: string, enabled: boolean) =>
    void perform("plugins_set_client_connected", { id, enabled });
  const remove = async () => {
    if (removing && (await perform("plugins_remove_client", { id: removing }))) {
      setRemoving(null);
    }
  };
  return {
    open,
    name,
    setName,
    path,
    setPath,
    format,
    setFormat,
    busy,
    error,
    removing,
    setRemoving,
    browse,
    add,
    connect,
    remove,
    show: () => {
      setName("");
      setPath("");
      setFormat("json");
      setError(null);
      setOpen(true);
    },
    close: () => {
      if (!busy) {
        setOpen(false);
        setError(null);
      }
    },
  };
}
