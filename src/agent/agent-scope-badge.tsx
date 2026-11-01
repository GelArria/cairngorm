// Marks who a feature or setting belongs to: the Cairngorm agent (the app's own agent,
// configured in AI providers) or the agent CLIs you run in terminals (Claude Code, Codex…).
import { Badge } from "@/common/ui/badge";
import { Icon } from "@/common/ui/icon";

export type AgentScope = "cairngorm" | "cli";

const SCOPES = {
  cairngorm: {
    label: "Uses Cairngorm agent",
    icon: "robot",
    title: "Runs through the Cairngorm agent and its provider in Settings › AI providers.",
  },
  cli: {
    label: "CLI agents only",
    icon: "terminal-window",
    title:
      "For agent CLIs you run in terminals, such as Claude Code or Codex. The Cairngorm agent does not use this.",
  },
} as const;

export function AgentScopeBadge({
  scope,
  class: className,
}: {
  scope: AgentScope;
  class?: string;
}) {
  const { label, icon, title } = SCOPES[scope];
  return (
    <Badge
      variant={scope === "cairngorm" ? "secondary" : "outline"}
      title={title}
      class={className}
    >
      <Icon name={icon} class="mr-1 text-[11px]" />
      {label}
    </Badge>
  );
}
