import { Button } from "@/common/ui/button";
import { useCrashDialog } from "@/debug/hooks/use-crash-dialog";
import { Props } from "@/debug/model/use-crash-dialog";

export function CrashDialog({ report }: Props) {
  const { copied, handleCopy, handleClose } = useCrashDialog({ report });

  return (
    <div class="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div class="relative z-10 w-[600px] max-w-[90vw] rounded-lg border border-border bg-card p-5 shadow-xl">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="text-sm font-semibold text-foreground">Crash Report</h3>
          <span class="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] font-mono text-destructive uppercase">
            {report.source}
          </span>
        </div>
        {report.message && (
          <p class="text-xs text-red-400 font-mono mb-2 break-all">{report.message}</p>
        )}
        {report.location && (
          <p class="text-[10px] text-muted-foreground mb-1">📍 {report.location}</p>
        )}
        <p class="text-[10px] text-muted-foreground mb-3">🕐 {report.timestamp}</p>
        <pre class="max-h-[55vh] overflow-auto rounded bg-muted p-3 text-[11px] font-mono text-foreground leading-relaxed whitespace-pre-wrap break-all">
          {report.stacktrace}
        </pre>
        <div class="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? "✓ Copied!" : "Copy Stacktrace"}
          </Button>
          <Button
            variant="default"
            size="sm"
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleClose}
          >
            Close App
          </Button>
        </div>
      </div>
    </div>
  );
}
