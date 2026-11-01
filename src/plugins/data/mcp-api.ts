import { invoke } from "@tauri-apps/api/core";

export interface McpServer {
  agent: string;
  agentName: string;
  name: string;
  /** "user": every project; "local": this project, private; "project": shared file. */
  scope: "user" | "local" | "project";
  transport: string;
  /** Command line or URL. */
  target: string;
  configPath: string;
  enabled: boolean;
  /** Cairngorm's own plugin bridge, managed from Plugins. */
  managed: boolean;
}

export interface McpAgent {
  id: string;
  name: string;
  configPath: string;
}

export interface McpInventory {
  servers: McpServer[];
  agents: McpAgent[];
}

export interface NewMcpServer {
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
}

export const listMcpServers = (project: string | null) =>
  invoke<McpInventory>("mcp_servers_list", { project });
export const removeMcpServer = (project: string | null, server: McpServer) =>
  invoke<McpInventory>("mcp_server_remove", {
    project,
    agent: server.agent,
    scope: server.scope,
    name: server.name,
  });
/** Resolves with [agent, error] pairs for agents whose config could not be edited. */
export const addMcpServer = (agents: string[], server: NewMcpServer) =>
  invoke<[string, string][]>("mcp_server_add", { agents, server });

/** Split a command line into words, keeping "quoted parts" together. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    words.push(match[1] ?? match[2] ?? match[3]);
  }
  return words;
}

export function filterServers(servers: McpServer[], query: string, agent: string): McpServer[] {
  const needle = query.trim().toLowerCase();
  return servers.filter((s) => {
    const text = `${s.name} ${s.agentName} ${s.target}`.toLowerCase();
    return (agent === "all" || s.agent === agent) && (!needle || text.includes(needle));
  });
}
