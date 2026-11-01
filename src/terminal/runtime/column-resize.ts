interface ColumnResizeOptions {
  col: number;
  resizeColumns: (col: number, incremental: number, containerWidth: number) => void;
}
export function startColumnResize(e: MouseEvent, { col, resizeColumns }: ColumnResizeOptions) {
  startTrackResize(e, "columns", col, resizeColumns);
}

export function startRowResize(
  e: MouseEvent,
  { row, resizeRows }: { row: number; resizeRows: ColumnResizeOptions["resizeColumns"] },
) {
  startTrackResize(e, "rows", row, resizeRows);
}

export function getTrackSpace(container: HTMLElement, axis: "columns" | "rows"): number {
  const columns = axis === "columns";
  const style = getComputedStyle(container);
  const count = style[columns ? "gridTemplateColumns" : "gridTemplateRows"].split(" ").length;
  const padding = columns
    ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(columns ? style.columnGap : style.rowGap) || 0;
  return (columns ? container.clientWidth : container.clientHeight) - padding - gap * (count - 1);
}

function startTrackResize(
  e: MouseEvent,
  axis: "columns" | "rows",
  index: number,
  resize: ColumnResizeOptions["resizeColumns"],
) {
  if (e.button !== 0) {
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  const columns = axis === "columns";
  const start = columns ? e.clientX : e.clientY;
  // [style*='grid'] would match the wrapper (grid-column) → delta scaled to the pane;
  // we want the real grid container
  const container = (e.currentTarget as HTMLElement).closest(
    `[style*="grid-template-${axis}"]`,
  ) as HTMLElement;
  if (!container) {
    return;
  }
  const containerSize = getTrackSpace(container, axis);
  let lastDelta = 0;
  const onMove = (ev: MouseEvent) => {
    // Lost mouseup (Snip Tool / alt-tab): cancel without stale deltas
    if (ev.buttons === 0) {
      onUp();
      return;
    }
    const totalDelta = (columns ? ev.clientX : ev.clientY) - start;
    const incremental = totalDelta - lastDelta;
    lastDelta = totalDelta;
    resize(index, incremental, containerSize);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    window.removeEventListener("blur", onBlur);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const onBlur = () => onUp();
  document.body.style.cursor = columns ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  window.addEventListener("blur", onBlur);
}
