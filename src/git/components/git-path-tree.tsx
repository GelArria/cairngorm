import { Icon } from "@/common/ui/icon";
import type { ComponentChildren } from "preact";

// Shared changed-file tree. Native details retain keyboard access and local collapse state.
export function GitPathTree<T extends { path: string }>({
  files,
  render,
  prefix = "",
}: {
  files: T[];
  render: (file: T) => ComponentChildren;
  prefix?: string;
}) {
  const folders = new Map<string, T[]>();
  const leaves: T[] = [];
  for (const file of files) {
    const remaining = file.path.slice(prefix.length);
    const slash = remaining.indexOf("/");
    if (slash < 0) {
      leaves.push(file);
    } else {
      const folder = remaining.slice(0, slash);
      folders.set(folder, [...(folders.get(folder) ?? []), file]);
    }
  }
  return (
    <>
      {[...folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, children]) => (
          <details key={prefix + name} open class="min-w-0" data-testid="git-path-folder">
            <summary
              class="cursor-pointer truncate py-1 pl-3 text-[11px] text-muted-foreground focus-visible:outline-ring"
              title={prefix + name}
            >
              <Icon name="folder" class="mx-1 text-[11px]" />
              {name}
            </summary>
            <div class="min-w-0 border-l border-border ml-3 [&_[data-git-directory]]:hidden">
              <GitPathTree files={children} render={render} prefix={`${prefix}${name}/`} />
            </div>
          </details>
        ))}
      {leaves.map((file) => render(file))}
    </>
  );
}
