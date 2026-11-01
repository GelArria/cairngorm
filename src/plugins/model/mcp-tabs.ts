import { type McpServer } from "@/plugins/data/mcp-api";

export function agentTabs(servers: McpServer[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const s of servers) {
    const entry = counts.get(s.agent) ?? { label: s.agentName, count: 0 };
    entry.count += 1;
    counts.set(s.agent, entry);
  }
  return [
    { id: "all", label: "All", count: servers.length },
    ...[...counts].map(([id, { label, count }]) => ({
      id,
      label,
      count,
    })),
  ];
}
