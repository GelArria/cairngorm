import { Input } from "@/common/ui/input";
import { cn } from "@/common/utils";
import { renameProject, type Project } from "@/projects/index";
import { useEffect, useRef } from "preact/hooks";

/** A name-sized editor, shared by the tile and the sidebar header. No modal or backdrop. */
export function ProjectNameInput({
  project,
  onClose,
  class: className = "",
  inputClass,
}: {
  project: Project;
  onClose: () => void;
  class?: string;
  /** Extra classes for the field itself (e.g. the header centers and enlarges it). */
  inputClass?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    const input = host.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);
  const finish = (value?: string) => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    if (value !== undefined) {
      renameProject(project.id, value);
    }
    onClose();
  };
  return (
    <div ref={host} class={className}>
      <Input
        aria-label="Project name"
        defaultValue={project.name}
        maxLength={40}
        class={cn(
          "h-5 rounded-none border-0 border-b bg-transparent px-0 py-0 text-[12px] font-semibold focus-visible:ring-0",
          project.background?.startsWith("image:")
            ? "border-white/35 text-white drop-shadow"
            : "border-border text-foreground",
          inputClass,
        )}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.isComposing) {
            return;
          }
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finish(e.key === "Enter" ? e.currentTarget.value : undefined);
          }
        }}
      />
    </div>
  );
}
