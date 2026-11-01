import { Icon } from "@/common/ui/icon";
import { useMemo } from "preact/hooks";
import { PREVIEW_MAX_CELL_CHARS, PREVIEW_MAX_MARKDOWN_CHARS } from "./limits";
import { MarkdownViewer } from "./markdown-viewer";

export function PreviewMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon name="file-text" class="text-2xl text-muted-foreground" />
      <strong class="text-sm">{title}</strong>
      <span class="max-w-md text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

export function sourceOf(value: unknown): string {
  return Array.isArray(value) ? value.join("") : String(value ?? "");
}

export function NotebookViewer({ content }: { content: string }) {
  const tooLarge = content.length > PREVIEW_MAX_NOTEBOOK_CHARS;
  const notebook = useMemo(() => {
    if (content.length > PREVIEW_MAX_NOTEBOOK_CHARS) {
      return null;
    }
    try {
      return JSON.parse(content) as {
        cells?: Array<{
          cell_type?: string;
          source?: unknown;
          outputs?: Array<{ text?: unknown; data?: Record<string, unknown> }>;
        }>;
      };
    } catch {
      return null;
    }
  }, [content]);
  if (tooLarge) {
    return (
      <PreviewMessage
        title="Notebook preview limited"
        detail="This notebook is larger than 10 MB. Open it in the editor to inspect the full file."
      />
    );
  }
  if (!notebook || !Array.isArray(notebook.cells)) {
    return <PreviewMessage title="Invalid notebook" detail="The file is not valid Jupyter JSON." />;
  }
  const cells = notebook.cells.filter((cell) => cell && typeof cell === "object").slice(0, 200);
  return (
    <div data-testid="notebook-viewer" class="file-preview notebook-preview">
      {cells.map((cell, i) => (
        <section key={i} class="notebook-cell">
          <div class="notebook-cell-label">
            {cell.cell_type === "markdown" ? "Markdown" : "Python"}
          </div>
          {cell.cell_type === "markdown" ? (
            <MarkdownViewer content={sourceOf(cell.source).slice(0, PREVIEW_MAX_MARKDOWN_CHARS)} />
          ) : (
            <pre class="notebook-source">
              {sourceOf(cell.source).slice(0, PREVIEW_MAX_CELL_CHARS)}
            </pre>
          )}
          {(Array.isArray(cell.outputs) ? cell.outputs : []).map((out, n) =>
            out?.data?.["image/png"] ? (
              <img
                key={n}
                class="notebook-output max-w-full"
                src={`data:image/png;base64,${sourceOf(out.data["image/png"])}`}
                alt="Notebook output"
              />
            ) : (
              <pre key={n} class="notebook-output">
                {sourceOf(out?.text ?? out?.data?.["text/plain"] ?? "").slice(
                  0,
                  PREVIEW_MAX_CELL_CHARS,
                )}
              </pre>
            ),
          )}
        </section>
      ))}
      {notebook.cells.length > cells.length && (
        <div class="p-2 text-[10px] text-muted-foreground">
          Showing the first {cells.length} cells.
        </div>
      )}
    </div>
  );
}
const PREVIEW_MAX_NOTEBOOK_CHARS = 10_000_000;
