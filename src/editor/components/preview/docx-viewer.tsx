import { useEffect, useRef, useState } from "preact/hooks";
import { errorMessage } from "@/common/errors";

const FRAME = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
html,body{margin:0;background:#e8e8e8;color:#171717;font:12pt Georgia,serif}.docx-wrapper{background:transparent!important}section.docx{max-width:100%;box-sizing:border-box}article{overflow-wrap:anywhere}img{max-width:100%}table{max-width:100%}a{color:inherit;text-decoration:underline;cursor:default}@media(max-width:600px){section.docx{padding:24px!important;width:100%!important}.docx-wrapper{padding:12px!important}table{display:block;overflow-x:auto}}
</style></head><body></body></html>`;

export function DocxViewer({
  src,
  title,
  readError,
  chrome = true,
  onReady,
  onError,
}: {
  src?: string;
  title: string;
  readError?: string;
  /** False inside a document pane, which shows its own header. */
  chrome?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<{ source?: string; error?: string }>({});
  useEffect(() => {
    const document = frame.current?.contentDocument;
    if (!src || !loaded || !document) {
      return;
    }
    let alive = true;
    const body = document.createElement("div");
    const styles = document.createElement("div");
    document.body.replaceChildren(styles, body);
    setStatus({});
    const preventNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", preventNavigation);
    (async () => {
      const { decodeDocxSource, validateDocx } = await import("../../model/docx-archive");
      const buffer = decodeDocxSource(src);
      await validateDocx(buffer);
      if (!alive) {
        return;
      }
      const { renderAsync } = await import("docx-preview");
      if (!alive) {
        return;
      }
      await renderAsync(buffer, body, styles, {
        renderAltChunks: false,
        ignoreFonts: true,
        useBase64URL: true,
        ignoreHeight: true,
        renderComments: false,
        experimental: false,
      });
      if (alive) {
        for (const element of Array.from(body.querySelectorAll("a"))) {
          element.removeAttribute("href");
        }
        setStatus({ source: src });
        onReady?.();
      }
    })().catch((error) => {
      if (alive) {
        document.body.replaceChildren();
        setStatus({ source: src, error: errorMessage(error) });
        onError?.(errorMessage(error));
      }
    });
    return () => {
      alive = false;
      document.removeEventListener("click", preventNavigation);
      document.body.replaceChildren();
    };
  }, [src, loaded]);
  const error = readError || (status.source === src ? status.error : undefined);
  const ready = Boolean(src && status.source === src && !error);
  return (
    <div data-testid="docx-viewer" class="flex h-full min-h-0 w-full flex-col bg-muted/20">
      {chrome && (
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-xs">
          <span class="min-w-0 flex-1 truncate" title={title}>
            {title}
          </span>
          <span class="text-muted-foreground">DOCX · Read-only preview</span>
        </div>
      )}
      {error && chrome ? (
        <p role="alert" class="p-4 text-xs text-destructive">
          Could not preview document: {error}
        </p>
      ) : (
        !ready &&
        !error && (
          <p role="status" class="p-4 text-xs text-muted-foreground">
            Loading document…
          </p>
        )
      )}
      <iframe
        ref={frame}
        title={`Document: ${title}`}
        sandbox="allow-same-origin"
        srcDoc={FRAME}
        onLoad={() => setLoaded(true)}
        class="min-h-0 w-full flex-1 border-0"
        style={{ visibility: ready ? "visible" : "hidden" }}
      />
    </div>
  );
}
