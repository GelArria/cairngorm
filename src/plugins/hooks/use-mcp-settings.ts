import { filterServers, type McpServer } from "@/plugins/data/mcp-api";
import { useMcpServers } from "@/plugins/hooks/use-mcp-servers";
import { agentTabs } from "@/plugins/model/mcp-tabs";
import { useMemo, useState } from "preact/hooks";

export function useMcpSettings({ open }: { open: boolean }) {
  const { project, inventory, loading, error, refresh, remove, add } = useMcpServers(open);
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState("all");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [removeError, setRemoveError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const servers = inventory?.servers ?? [];
  const tabs = useMemo(() => agentTabs(servers), [inventory]);
  // A tab that disappeared (its last server removed) falls back to All.
  const filter = tabs.length > 2 && tabs.some((t) => t.id === agent) ? agent : "all";
  const shown = useMemo(() => filterServers(servers, query, filter), [inventory, query, filter]);
  const message = error ?? rowError;

  const confirmRemove = async () => {
    if (!removing) {
      return;
    }
    setBusy(true);
    const failure = await remove(removing);
    setBusy(false);
    setRemoveError(failure ?? undefined);
    if (!failure) {
      setRemoving(null);
    }
  };
  return {
    project,
    inventory,
    loading,
    error,
    refresh,
    add,
    query,
    setQuery,
    agent,
    setAgent,
    adding,
    setAdding,
    removing,
    setRemoving,
    removeError,
    setRemoveError,
    busy,
    setRowError,
    servers,
    tabs,
    filter,
    shown,
    message,
    confirmRemove,
  };
}
