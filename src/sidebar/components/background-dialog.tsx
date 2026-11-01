import { projectAppearanceActions } from "../data/project-appearance";
// Customize a project's gem: its stone (colour + backdrop), its cut, or an image
// from disk as the backdrop. Applies on click — tiles and the header update live.
import { GEM_CUTS } from "@/common/branding/gem-cuts";
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Icon } from "@/common/ui/icon";
import type { Project } from "@/projects/api";
import { ProjectGem, STONES, stoneBackdrop } from "@/projects/visuals";
import type { ComponentChildren } from "preact";

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="px-5 pt-4">
      <h3 class="mb-2 text-[11px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function BackgroundDialog({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  if (!project) {
    return null;
  }
  const { current, stone, cut, yaw, setBg, pickImage, selectStone, selectCut, reset } =
    projectAppearanceActions(project);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Change Appearance"
      description={project.name}
      class="max-w-md"
      data-testid="background-dialog"
    >
      <Section title="Stone">
        <div class="grid grid-cols-4 gap-1.5">
          {STONES.map((s) => {
            const selected = current.kind === "stone" && current.stone.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-label={s.name}
                aria-pressed={selected}
                class="gem-card group relative h-[58px] overflow-hidden rounded-lg border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  "--stone": s.color,
                  background: stoneBackdrop(s.color),
                  borderColor: selected ? "hsl(var(--primary))" : "hsl(var(--border))",
                }}
                onClick={() => selectStone(s.id)}
              >
                <ProjectGem
                  color={s.color}
                  cut={cut}
                  yaw={yaw}
                  size={36}
                  class="absolute right-1 top-1"
                />
                {selected && (
                  <Icon name="check" class="absolute left-2 top-1 text-[11px] text-primary" />
                )}
                <span class="absolute bottom-1.5 left-2 text-[10.5px] font-medium text-foreground">
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Cut">
        <div class="grid grid-cols-7 gap-1">
          {GEM_CUTS.map((c) => {
            const selected = c.id === cut;
            return (
              <button
                key={c.id}
                type="button"
                aria-label={`${c.name} cut`}
                aria-pressed={selected}
                title={c.name}
                class={`group flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[9.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                style={
                  selected
                    ? { borderColor: stone.color, background: `${stone.color}1f` }
                    : undefined
                }
                onClick={() => selectCut(c.id)}
              >
                {/* above the 48 px mini threshold: the 16-facet mesh shows each outline */}
                <ProjectGem color={stone.color} cut={c.id} yaw={0.6} size={50} />
                {c.name}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Backdrop">
        <div class="flex items-center gap-2 pb-4">
          <Button variant="outline" size="sm" class="gap-1.5" onClick={pickImage}>
            <Icon name="file-image" class="text-xs" />
            {current.kind === "image" ? "Change image…" : "Use an image…"}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            aria-pressed={current.kind === "none"}
            onClick={() => setBg("none")}
          >
            Plain
          </Button>
          <span class="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={!project.background && !project.cut && !project.color}
            onClick={reset}
          >
            Reset
          </Button>
        </div>
      </Section>
    </Dialog>
  );
}
