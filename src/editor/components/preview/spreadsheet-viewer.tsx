import { useEffect, useState } from "preact/hooks";
import { dataUrlToArrayBuffer, readFirstSheet } from "../../model/xlsx-lite";
import { PREVIEW_MAX_CELL_CHARS, PREVIEW_MAX_COLUMNS, PREVIEW_MAX_ROWS } from "./limits";
import { PreviewMessage } from "./notebook-viewer";

export function delimitedRows(
  content: string,
  delimiter = ",",
  maxRows = PREVIEW_MAX_ROWS,
  maxColumns = PREVIEW_MAX_COLUMNS,
) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    if (row.length < maxColumns) {
      row.push(field.slice(0, PREVIEW_MAX_CELL_CHARS));
    }
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((v) => v.length > 0)) {
      rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < content.length && rows.length < maxRows; i++) {
    const c = content[i];
    if (c === '"' && quoted && content[i + 1] === '"') {
      field += '"';
      i++;
      continue;
    }
    if (c === '"' && (quoted || field.length === 0)) {
      quoted = !quoted;
      continue;
    }
    if (!quoted && c === delimiter) {
      pushField();
      continue;
    }
    if (!quoted && c === "\n") {
      pushRow();
      continue;
    }
    if (c !== "\r" && field.length < PREVIEW_MAX_CELL_CHARS) {
      field += c;
    }
  }
  if ((field || row.length) && rows.length < maxRows) {
    pushRow();
  }
  return rows;
}

export function Table({ rows }: { rows: string[][] }) {
  return (
    <div data-testid="spreadsheet-viewer" class="file-preview spreadsheet-preview">
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= PREVIEW_MAX_ROWS && (
        <div class="p-2 text-[10px] text-muted-foreground">
          Showing the first {PREVIEW_MAX_ROWS} rows.
        </div>
      )}
    </div>
  );
}

export function SpreadsheetViewer({
  content,
  src,
  extension,
}: {
  content: string;
  src?: string;
  extension: string;
}) {
  const [rows, setRows] = useState<string[][] | null>(() =>
    extension === "csv" || extension === "tsv"
      ? delimitedRows(content, extension === "tsv" ? "\t" : ",")
      : null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (rows || !src || extension !== "xlsx") {
      return;
    }
    let alive = true;
    readFirstSheet(dataUrlToArrayBuffer(src))
      .then((value) => {
        if (alive) {
          setRows(value);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [rows, src, extension]);
  if (extension === "csv" || extension === "tsv") {
    return <Table rows={rows ?? []} />;
  }
  if (error || extension === "xls") {
    return (
      <PreviewMessage
        title="Spreadsheet preview unavailable"
        detail={error || "Legacy .xls files are not supported. Save it as .xlsx or .csv."}
      />
    );
  }
  return rows ? (
    <Table rows={rows} />
  ) : (
    <PreviewMessage title="Loading workbook…" detail="Reading the first worksheet" />
  );
}
