import { useSkillSettings } from "@/skills/hooks/use-skill-settings";
// Settings ▸ Skills: every personal skill across agent harness folders, with on/off,
// preview and a form that scaffolds a new SKILL.md.
import { AgentScopeBadge } from "@/agent/agent-scope-badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import { ProviderLogo } from "@/integrations/components/provider-logo";
import { SettingsFilterTabs, SettingsSearch } from "@/settings/components/settings-controls";
import { SettingsPage } from "@/settings/components/settings-layout";
import { NewSkillDialog, SkillPreviewDialog } from "./components/skill-dialogs";
import { SkillRow } from "./components/skill-row";

export function SkillSettings({ open }: { open: boolean }) {
  const {
    skills,
    roots,
    loading,
    pending,
    refresh,
    setEnabled,
    create,
    query,
    setQuery,
    setHarness,
    adding,
    setAdding,
    preview,
    setPreview,
    setRowError,
    all,
    tabs,
    filter,
    shown,
    disabled,
    message,
  } = useSkillSettings({ open });

  return (
    <SettingsPage
      title="Skills"
      badge={<AgentScopeBadge scope="cli" />}
      description="Personal skills for the agent CLIs on this machine, such as Claude Code or Codex. The Cairngorm agent's own engine does not load them. Turning one off renames its SKILL.md so no CLI loads it; turning it on restores it."
      data-testid="skill-settings"
      aria-busy={loading}
      actions={
        <>
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Refresh skills"
            title="Refresh skills"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Icon name="arrows-clockwise" class={cn("text-xs", loading && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" class="gap-1.5" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            New skill
          </Button>
        </>
      }
    >
      <div class="flex flex-wrap items-center gap-2">
        <SettingsSearch value={query} onChange={setQuery} label="Filter skills" class="flex-1" />
        <span class="text-[11px] tabular-nums text-muted-foreground">
          {all.length} skills{disabled > 0 ? ` · ${disabled} off` : ""}
        </span>
      </div>
      {tabs.length > 2 && (
        <SettingsFilterTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            icon: tab.id === "all" ? undefined : <ProviderLogo id={tab.id} class="h-3.5 w-3.5" />,
          }))}
          active={filter}
          onSelect={setHarness}
          label="Skill folders"
        />
      )}
      {message && (
        <p role="alert" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message}
        </p>
      )}
      {skills === null ? (
        <p class="text-xs text-muted-foreground">{loading ? "Looking for skills…" : ""}</p>
      ) : shown.length === 0 ? (
        <p class="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          {all.length === 0
            ? "No personal skills yet. Create one, or add a folder with a SKILL.md to ~/.agents/skills."
            : `No skills match “${query.trim()}”.`}
        </p>
      ) : (
        <ul class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {shown.map((skill) => (
            <SkillRow
              key={skill.dir}
              skill={skill}
              pending={pending !== null}
              onEnabled={(next) => {
                setRowError(null);
                void setEnabled(skill, next);
              }}
              onPreview={() => setPreview(skill)}
              onError={setRowError}
            />
          ))}
        </ul>
      )}
      <NewSkillDialog
        open={adding}
        roots={roots}
        onCancel={() => setAdding(false)}
        onCreate={async (folder, name, description) => {
          const failure = await create(folder, name, description);
          if (!failure) {
            setAdding(false);
          }
          return failure;
        }}
      />
      <SkillPreviewDialog skill={preview} onClose={() => setPreview(null)} />
    </SettingsPage>
  );
}
