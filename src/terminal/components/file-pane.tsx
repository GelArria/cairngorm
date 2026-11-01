import { NOTEBOOK_EXTENSIONS, TEXT_EXTENSIONS } from "@/common/filesystem/file-kinds";
import { Button } from "@/common/ui/button";
import { CodeEditor } from "@/editor/components/code-editor/index";
import { ImageViewer } from "@/editor/components/image-viewer";
import { DocumentPane } from "@/documents/document-pane";
import { MarkdownViewer, NotebookViewer } from "@/editor/file-preview";
import { DiffView } from "@/git/components/diff-view";
import { GitCommitDetail } from "@/git/components/git-commit-detail";
import { GitGraphView } from "@/git/components/git-graph-view";
import { useFilePane } from "@/terminal/hooks/use-file-pane";
import { detachDocumentTab } from "../state/document-window-actions";
import { setDocumentProvider, setFileDirty } from "../state/file-actions";
import { memo } from "preact/compat";
import type { TermTab } from "../model/types";

/** A file tab rendered INSIDE the terminal grid — same pane frame, drag, splits. */
function FilePane({ tab, onChange }: { tab: TermTab; onChange(id: string, value: string): void }) {
  const {
    extension,
    isImage,
    imgSrc,
    isDocument,
    markdownEditing,
    setMarkdownEditing,
    saving,
    saveError,
    save,
  } = useFilePane({ tab });

  if (isImage) {
    return imgSrc ? (
      <ImageViewer src={imgSrc} alt={tab.title} />
    ) : (
      <div class="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading image…
      </div>
    );
  }
  if (isDocument) {
    return (
      <DocumentPane
        title={tab.title}
        extension={extension}
        path={tab.fullPath}
        dataUrl={tab.binarySrc}
        ticket={tab.documentTicket}
        paneId={tab.id}
        onDirtyChange={(dirty) => setFileDirty(tab.id, dirty)}
        onOpenWindow={tab.fullPath ? () => void detachDocumentTab(tab.id) : undefined}
        providerId={tab.document?.providerId}
        scope={tab.groupId ?? "default"}
        onProviderChange={(providerId) => setDocumentProvider(tab.id, providerId)}
      />
    );
  }
  if (NOTEBOOK_EXTENSIONS.has(extension)) {
    return <NotebookViewer content={tab.content ?? ""} />;
  }
  if (
    !markdownEditing &&
    TEXT_EXTENSIONS.has(extension) &&
    (extension === "md" || extension === "markdown")
  ) {
    return (
      <div class="relative h-full">
        <MarkdownViewer content={tab.content ?? ""} />
        <Button
          variant="outline"
          size="xs"
          class="absolute right-4 top-3"
          onClick={() => setMarkdownEditing(true)}
        >
          Edit
        </Button>
      </div>
    );
  }
  if (tab.extension === "git-graph") {
    return <GitGraphView content={tab.content ?? ""} />;
  }
  if (tab.extension === "git-commit") {
    return <GitCommitDetail content={tab.content ?? ""} />;
  }
  // Δ tabs opened from the Git panel: read-only diff renderer
  if (tab.extension === "diff") {
    return <DiffView content={tab.content ?? ""} />;
  }
  return (
    <div class="flex h-full flex-col">
      <div class="flex shrink-0 items-center justify-end gap-3 border-b border-border px-3 py-1.5">
        <span role="status" class="text-[11px] text-muted-foreground">
          {saving
            ? "Saving…"
            : tab.isDirty
              ? "Unsaved changes"
              : tab.fullPath
                ? "Saved"
                : "No file path"}
        </span>
        <Button
          variant="outline"
          size="xs"
          disabled={!tab.fullPath || !tab.isDirty || saving}
          title={tab.fullPath ? "Save file" : "This file has no path on disk"}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      {saveError && (
        <p role="alert" class="shrink-0 px-3 py-2 text-xs text-destructive">
          Could not save file: {saveError}
        </p>
      )}
      <div class="min-h-0 flex-1">
        <CodeEditor
          value={tab.content ?? ""}
          onChange={(value) => onChange(tab.id, value)}
          language={tab.extension ?? ""}
          filename={tab.fullPath ?? tab.title}
          placeholder="Start typing…"
          highlightLine={tab.highlightLine}
          highlightText={tab.highlightText}
          highlightKey={tab.highlightKey}
        />
      </div>
    </div>
  );
}

export const FilePaneView = memo(
  FilePane,
  (previous, next) => previous.tab === next.tab && previous.onChange === next.onChange,
);
