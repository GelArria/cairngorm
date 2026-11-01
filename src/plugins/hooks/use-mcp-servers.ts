import { errorMessage } from "@/common/errors";
import { getWorkspaceRootPath } from "@/common/filesystem/workspace-root";
import { useEffect, useState } from "preact/hooks";
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  type McpInventory,
  type McpServer,
  type NewMcpServer,
} from "../data/mcp-api";

/** Reads agent configs when Settings opens, scoped to the active project folder. */
export function useMcpServers(open: boolean) {
  const [project] = useState(getWorkspaceRootPath);
  const [inventory, setInventory] = useState<McpInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setInventory(await listMcpServers(project));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open]);

  /** Resolves with an error message, or null once removed. */
  const remove = async (server: McpServer) => {
    try {
      setInventory(await removeMcpServer(project, server));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  /** Resolves with the combined per-agent errors, or null when every agent took it. */
  const add = async (agents: string[], server: NewMcpServer) => {
    try {
      const failures = await addMcpServer(agents, server);
      await refresh();
      return failures.length ? failures.map(([who, why]) => `${who}: ${why}`).join("\n") : null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  return { project, inventory, loading, error, refresh, remove, add };
}
