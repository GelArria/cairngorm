import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { useGitCommitDetail } from "@/git/hooks/use-git-commit-detail";
import { open } from "@tauri-apps/plugin-shell";
import { type GitCommitFile } from "../data/git-bridge";
import { openGitCommit } from "../data/git-panes";
import { DiffView } from "./diff-view";
import { GitPathTree } from "./git-path-tree";

// Virtual read-only file pane; uses the existing tab identity/persistence path.
export function GitCommitDetail({
  content,
  inspector = false,
}: {
  content: string;
  inspector?: boolean;
}) {
  const {
    request,
    detail,
    error,
    setRetry,
    selected,
    setSelected,
    patch,
    diffError,
    setDiffRetry,
    copyError,
    setCopyError,
    tree,
    setTree,
  } = useGitCommitDetail({ content, inspector });

  if (!request) {
    return <InlineNotice message="Invalid commit reference. Open the commit again from History." />;
  }
  if (error) {
    return (
      <div class="p-4">
        <InlineNotice message={error} />
        <Button variant="outline" size="sm" class="mt-2" onClick={() => setRetry((v) => v + 1)}>
          Retry
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div role="status" class="p-4 text-xs text-muted-foreground">
        Loading commit details…
      </div>
    );
  }
  const added = detail.files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = detail.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const fileRow = (file: GitCommitFile) => (
    <Button
      key={file.path}
      variant="subtle"
      size="xs"
      class={`h-auto w-full justify-start gap-2 whitespace-normal px-1 py-1.5 text-left ${selected?.path === file.path ? "bg-accent" : ""}`}
      data-testid="git-commit-file"
      aria-pressed={selected?.path === file.path}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      onClick={() =>
        inspector
          ? openGitCommit(
              request.root,
              { hash: detail.hash, subject: detail.message.split("\n")[0] },
              file.path,
            )
          : setSelected(file)
      }
    >
      <span class="font-mono text-[10px] text-violet-400">{file.status[0]}</span>
      <span class="min-w-0 flex-1 break-all">{tree ? file.path.split("/").pop() : file.path}</span>
      <span class="shrink-0 text-[10px]">
        {file.added === null ? "binary" : `+${file.added} −${file.removed ?? 0}`}
      </span>
    </Button>
  );
  const github =
    detail.githubUrl &&
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[a-fA-F0-9]{40,64}$/.test(detail.githubUrl)
      ? detail.githubUrl
      : null;
  return (
    <section
      class="surface-base flex h-full min-h-0 flex-col overflow-auto bg-background [container-type:inline-size]"
      data-testid="git-commit-detail"
      aria-label="Commit details"
    >
      <header class="shrink-0 border-b border-border px-4 py-4 font-sans">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="font-semibold text-foreground">{detail.author}</span>
          <span class="break-all">{detail.email}</span>
          <time dateTime={detail.date}>{new Date(detail.date).toLocaleString()}</time>
        </div>
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <span class="break-all font-mono text-[11px] text-muted-foreground">{detail.hash}</span>
          <Button
            variant="subtle"
            size="icon-xs"
            aria-label="Copy commit hash"
            onClick={() => {
              void navigator.clipboard
                .writeText(detail.hash)
                .catch(() => setCopyError("Could not copy the commit hash."));
            }}
          >
            <Icon name="copy" />
          </Button>
          {detail.refs.map((ref) => (
            <span
              key={ref}
              class="max-w-full truncate rounded border border-border px-1.5 text-[10px] text-muted-foreground"
              title={ref}
            >
              {ref.replace("->", "→")}
            </span>
          ))}
        </div>
        {!!detail.parents?.length && (
          <div class="mt-2 break-all text-[10px] text-muted-foreground">
            Parents:{" "}
            {detail.parents.map((hash) => (
              <Button
                key={hash}
                variant="subtle"
                size="xs"
                class="h-4 px-1 font-mono text-[10px]"
                title={hash}
                onClick={() => openGitCommit(request.root, { hash, subject: "Parent commit" })}
              >
                {hash.slice(0, 7)}
              </Button>
            ))}
          </div>
        )}
        {github && (
          <Button
            variant="subtle"
            size="xs"
            class="mt-2"
            onClick={() => void open(github).catch((e) => setCopyError(String(e)))}
          >
            <Icon name="arrow-square-out" class="mr-1" />
            View on GitHub
          </Button>
        )}
        {copyError && <InlineNotice message={copyError} onDismiss={() => setCopyError(null)} />}
        <div class="mt-4" data-testid="git-commit-body">
          <h2 class="break-words text-[15px] font-semibold leading-snug text-foreground">
            {detail.message.split("\n")[0]}
          </h2>
          {detail.message.includes("\n") && (
            <pre class="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground">
              {detail.message.slice(detail.message.indexOf("\n") + 1).trim()}
            </pre>
          )}
        </div>
      </header>
      {inspector && (
        <Button
          variant="secondary"
          size="sm"
          class="mx-3 my-2 shrink-0"
          onClick={() =>
            openGitCommit(request.root, {
              hash: detail.hash,
              subject: detail.message.split("\n")[0],
            })
          }
        >
          View Commit
        </Button>
      )}
      <div class={`flex flex-1 flex-wrap ${inspector ? "min-h-0" : "min-h-[240px]"}`}>
        <nav
          class={`w-full shrink-0 overflow-auto border-b border-border p-2 ${inspector ? "" : "max-h-48 [@container(min-width:560px)]:max-h-none [@container(min-width:560px)]:w-56 [@container(min-width:560px)]:border-b-0 [@container(min-width:560px)]:border-r"}`}
          aria-label="Changed commit files"
        >
          <div class="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
            <span>{detail.files.length} changed files</span>
            <span>
              <span class="text-green-400">+{added}</span>{" "}
              <span class="text-red-400">−{removed}</span>
            </span>
          </div>
          <Button
            variant="subtle"
            size="xs"
            class="mb-1"
            aria-pressed={tree}
            onClick={() => setTree(!tree)}
          >
            {tree ? "File tree" : "File list"}
          </Button>
          {tree ? <GitPathTree files={detail.files} render={fileRow} /> : detail.files.map(fileRow)}
        </nav>
        {!inspector && (
          <div class="flex min-h-[240px] min-w-0 w-full flex-col [@container(min-width:560px)]:w-auto [@container(min-width:560px)]:flex-1">
            {selected && (
              <div class="shrink-0 break-all border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">
                {selected.oldPath ? `${selected.oldPath} → ` : ""}
                {selected.path}
              </div>
            )}
            {diffError ? (
              <div class="p-3">
                <InlineNotice message={diffError} />
                <Button
                  variant="outline"
                  size="sm"
                  class="mt-2"
                  onClick={() => setDiffRetry((v) => v + 1)}
                >
                  Retry diff
                </Button>
              </div>
            ) : !selected ? (
              <div class="p-4 text-xs text-muted-foreground">
                This commit has no changed files relative to its first parent.
              </div>
            ) : patch === null ? (
              <div role="status" class="p-4 text-xs text-muted-foreground">
                Loading historical diff…
              </div>
            ) : (
              <div class="min-h-0 flex-1">
                <DiffView
                  key={`${detail.hash}:${selected.path}`}
                  content={patch || "No textual diff (rename, mode change or empty file)."}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
