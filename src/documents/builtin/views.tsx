// Views of the built-in providers. Each receives the session snapshot and reports
// readiness exactly like an isolated provider does.
import { DocxViewer, PdfViewer, SpreadsheetViewer } from "@/editor/file-preview";
import type { ComponentType } from "preact";
import { useEffect } from "preact/hooks";
import { useSnapshotDataUrl } from "../hooks/use-snapshot-url";
import type { DocumentViewProps } from "../model/provider";

function useReadyWhen(ready: boolean, onReady: () => void) {
  useEffect(() => {
    if (ready) {
      onReady();
    }
  }, [ready]);
}

function DocxView({ snapshot, title, onReady, onError }: DocumentViewProps) {
  const src = useSnapshotDataUrl(snapshot);
  return (
    <DocxViewer
      src={src || undefined}
      title={title}
      chrome={false}
      onReady={onReady}
      onError={onError}
    />
  );
}

function SpreadsheetView({ snapshot, onReady }: DocumentViewProps) {
  const delimited = snapshot.extension === "csv" || snapshot.extension === "tsv";
  const src = useSnapshotDataUrl(snapshot);
  useReadyWhen(delimited || Boolean(src), onReady);
  if (delimited) {
    return (
      <SpreadsheetViewer
        content={new TextDecoder().decode(snapshot.bytes)}
        extension={snapshot.extension}
      />
    );
  }
  return src ? <SpreadsheetViewer content="" src={src} extension={snapshot.extension} /> : null;
}

function PdfView({ snapshot, title, onReady }: DocumentViewProps) {
  const src = useSnapshotDataUrl(snapshot);
  useReadyWhen(Boolean(src), onReady);
  return src ? <PdfViewer src={src} title={title} chrome={false} /> : null;
}

export const BUILTIN_VIEWS: Record<string, ComponentType<DocumentViewProps>> = {
  "cairngorm.docx-preview": DocxView,
  "cairngorm.spreadsheet-preview": SpreadsheetView,
  "cairngorm.pdf-viewer": PdfView,
};
