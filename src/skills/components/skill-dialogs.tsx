import { useNewSkillDialog } from "@/skills/hooks/use-new-skill-dialog";
import { useSkillPreview } from "@/skills/hooks/use-skill-preview";
// New skill form and the read-only SKILL.md preview, both on the shared Dialog.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { RadioGroup, RadioGroupItem, RadioIndicator } from "@/common/ui/radio-group";
import { Textarea } from "@/common/ui/textarea";
import { type Skill, type SkillRoot } from "../data/skills-api";

export function NewSkillDialog({
  open,
  roots,
  onCancel,
  onCreate,
}: {
  open: boolean;
  roots: SkillRoot[];
  onCancel: () => void;
  /** Resolves with an error to keep the dialog open, or null when created. */
  onCreate: (harness: string, name: string, description: string) => Promise<string | null>;
}) {
  const {
    name,
    setName,
    description,
    setDescription,
    harness,
    setHarness,
    error,
    saving,
    nameProblem,
    submit,
  } = useNewSkillDialog({ open, roots, onCancel, onCreate });

  return (
    <Dialog open={open} onClose={onCancel} title="New skill" class="max-w-md">
      <form class="flex flex-col gap-4 px-5 py-4" onSubmit={submit}>
        <div class="flex flex-col gap-1.5">
          <Label for="skill-name" class="text-xs">
            Name
          </Label>
          <Input
            id="skill-name"
            autoFocus
            value={name}
            placeholder="review-migrations"
            spellcheck={false}
            class="h-8 font-mono text-xs"
            onInput={(e) => setName(e.currentTarget.value.toLowerCase())}
          />
          {nameProblem && <span class="text-[11px] text-destructive">{nameProblem}</span>}
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="skill-description" class="text-xs">
            When should an agent use it?
          </Label>
          <Textarea
            id="skill-description"
            rows={3}
            value={description}
            placeholder="Use when the user asks to review database migrations before release."
            class="text-xs"
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Folder</span>
          <RadioGroup
            value={harness}
            onValueChange={setHarness}
            aria-label="Skills folder"
            class="grid grid-cols-2 gap-1.5"
          >
            {roots.map((root) => (
              <RadioGroupItem
                key={root.id}
                value={root.id}
                title={root.path}
                class="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:border-primary/60 data-[state=checked]:bg-accent/40"
              >
                <RadioIndicator checked={harness === root.id} />
                <span class="truncate">{root.name}</span>
              </RadioGroupItem>
            ))}
          </RadioGroup>
          <span class="text-[11px] text-muted-foreground">
            "Agents" (~/.agents/skills) is read by harnesses that follow the shared skills folder.
          </span>
        </div>
        {error && (
          <p role="alert" class="text-xs text-destructive">
            {error}
          </p>
        )}
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={saving || !name || !!nameProblem || !description.trim()}
          >
            {saving ? "Creating…" : "Create skill"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SkillPreviewDialog({
  skill,
  onClose,
}: {
  skill: Skill | null;
  onClose: () => void;
}) {
  const { text } = useSkillPreview({ skill, onClose });

  return (
    <Dialog
      open={skill !== null}
      onClose={onClose}
      title={skill?.name ?? "Skill"}
      description={skill?.file}
      class="max-w-3xl"
    >
      <pre class="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[11.5px] leading-relaxed text-foreground/90">
        {text ?? "Loading…"}
      </pre>
    </Dialog>
  );
}
