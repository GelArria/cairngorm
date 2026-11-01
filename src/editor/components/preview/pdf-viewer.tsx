import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";

export function PdfViewer({
  src,
  title,
  chrome = true,
}: {
  src: string;
  title: string;
  /** False inside a document pane, which shows its own header. */
  chrome?: boolean;
}) {
  return (
    <div data-testid="pdf-viewer" class="flex h-full w-full flex-col bg-muted/20">
      {chrome && (
        <div class="flex h-8 items-center gap-2 border-b border-border px-3 text-[11px] text-muted-foreground">
          <Icon name="file-type" />
          {title}
          <Button
            variant="subtle"
            size="xs"
            class="ml-auto"
            onClick={() => window.open(src, "_blank")}
          >
            Open externally
          </Button>
        </div>
      )}
      <iframe title={title} src={src} class="min-h-0 flex-1 w-full border-0" />
    </div>
  );
}
