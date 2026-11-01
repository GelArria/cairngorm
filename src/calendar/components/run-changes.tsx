// The files a scheduled run changed, shown beside its result so unattended edits are reviewed.
export function RunChanges({ changes }: { changes?: string[] }) {
  return (
    <section aria-label="Files changed by this run" class="space-y-1.5" data-testid="run-changes">
      <h4 class="text-xs font-medium">Files changed by this run</h4>
      {changes === undefined ? (
        <p class="text-xs text-muted-foreground">
          Not available: changes are listed for Git projects only. Check the project folder.
        </p>
      ) : changes.length === 0 ? (
        <p class="text-xs text-muted-foreground">No files changed.</p>
      ) : (
        <ul class="max-h-48 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed">
          {changes.map((line) => (
            <li key={line} class="break-all">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
