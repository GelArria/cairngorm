import { splitCommand, type McpAgent, type NewMcpServer } from "@/plugins/data/mcp-api";
import { useLayoutEffect, useState } from "preact/hooks";

export function useMcpAddDialog({
  open,
  agents,
  onAdd,
}: {
  open: boolean;
  agents: McpAgent[];
  /** Resolves with an error to keep the dialog open, or null when added everywhere. */
  onAdd: (agents: string[], server: NewMcpServer) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    if (open) {
      setName("");
      setCommand("");
      setUrl("");
      setError(null);
      setChosen(agents.map((a) => a.id));
    }
  }, [open]);
  const nameOk = /^[A-Za-z0-9_-]{1,64}$/.test(name);
  const targetOk = transport === "http" ? /^https?:\/\/\S+$/.test(url) : !!command.trim();
  const submit = async (e: Event) => {
    e.preventDefault();
    const [cmd = "", ...args] = splitCommand(command);
    setSaving(true);
    setError(await onAdd(chosen, { name, transport, command: cmd, args, url }));
    setSaving(false);
  };
  const toggle = (id: string, on: boolean) =>
    setChosen((list) => (on ? [...list, id] : list.filter((a) => a !== id)));
  return {
    name,
    setName,
    transport,
    setTransport,
    command,
    setCommand,
    url,
    setUrl,
    chosen,
    error,
    saving,
    nameOk,
    targetOk,
    submit,
    toggle,
  };
}
