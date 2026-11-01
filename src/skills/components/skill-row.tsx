import { openDefault, revealPath } from "@/common/filesystem/fs-ops";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Icon, type IconName } from "@/common/ui/icon";
import { Toggle } from "@/common/ui/toggle";
import { cn } from "@/common/utils";
import { ProviderLogo } from "@/integrations/components/provider-logo";
import { useState } from "preact/hooks";
import type { Skill } from "../data/skills-api";

const HARNESS_NAMES: Record<string, string> = {
  agents: "Agents",
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  droid: "Droid",
  cursor: "Cursor",
  copilot: "Copilot",
  gemini: "Gemini CLI",
};

export const harnessName = (id: string) => HARNESS_NAMES[id] ?? id;

function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="subtle" size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} class="text-xs" />
    </Button>
  );
}

export function SkillRow({
  skill,
  pending,
  onEnabled,
  onPreview,
  onError,
}: {
  skill: Skill;
  pending: boolean;
  onEnabled: (enabled: boolean) => void;
  onPreview: () => void;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const fail = (e: unknown) => onError(String(e));
  const copy = () => {
    navigator.clipboard
      ?.writeText(skill.file)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(fail);
  };
  return (
    <li class="flex gap-3 px-4 py-3" data-testid={`skill-${skill.harness}-${skill.name}`}>
      <div class={cn("min-w-0 flex-1", !skill.enabled && "opacity-60")}>
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-xs font-semibold text-foreground">{skill.name}</span>
          <Badge variant="muted" class="gap-1">
            <ProviderLogo id={skill.harness} class="h-3 w-3" />
            {skill.harnessName}
          </Badge>
          {skill.linkedFrom.length > 0 && (
            <span class="text-[11px] text-muted-foreground">
              also in {skill.linkedFrom.map(harnessName).join(", ")}
            </span>
          )}
        </div>
        <p
          class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
          title={skill.description}
        >
          {skill.description || "No description in SKILL.md"}
        </p>
        <code
          class="mt-1 block truncate font-mono text-[10.5px] text-muted-foreground/70"
          title={skill.file}
        >
          {skill.file}
        </code>
      </div>
      <div class="flex shrink-0 flex-col items-end justify-between gap-2">
        <Toggle
          checked={skill.enabled}
          disabled={pending}
          aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
          data-testid={`skill-toggle-${skill.name}`}
          onCheckedChange={onEnabled}
        />
        <div class="flex items-center gap-0.5">
          <RowAction icon="eye" label="Preview SKILL.md" onClick={onPreview} />
          <RowAction
            icon={copied ? "check" : "copy"}
            label={copied ? "Copied" : "Copy path"}
            onClick={copy}
          />
          <RowAction
            icon="folder-open"
            label="Show in folder"
            onClick={() => void revealPath(skill.file).catch(fail)}
          />
          <RowAction
            icon="arrow-square-out"
            label="Open in default editor"
            onClick={() => void openDefault(skill.file).catch(fail)}
          />
        </div>
      </div>
    </li>
  );
}
