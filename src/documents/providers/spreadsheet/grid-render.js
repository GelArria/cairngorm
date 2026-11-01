// Draws the part of the sheet in view: only visible rows and columns exist in the DOM, and
// cell text is always set as text, never as markup.
import { cellRef, columnName } from "./cells.js";
import { ROW_HEIGHT } from "./layout.js";
function head(text, active, style) {
    const element = document.createElement("div");
    element.className = `head${active ? " active" : ""}`;
    element.textContent = text;
    Object.assign(element.style, style);
    return element;
}
export function renderView(view) {
    const { body: b, columns, active } = view;
    view.cols.style.transform = `translateX(${-b.scrollLeft}px)`;
    view.rows.style.transform = `translateY(${-b.scrollTop}px)`;
    const firstRow = Math.floor(b.scrollTop / ROW_HEIGHT);
    const lastRow = Math.min(view.rowCount - 1, Math.ceil((b.scrollTop + b.clientHeight) / ROW_HEIGHT));
    const firstCol = columns.at(b.scrollLeft);
    const lastCol = columns.at(b.scrollLeft + b.clientWidth);
    const cells = [];
    const colHeads = [];
    const rowHeads = [];
    for (let col = firstCol; col <= lastCol; col++) {
        colHeads.push(head(columnName(col), col === active.col, {
            left: `${columns.left(col)}px`,
            width: `${columns.width(col)}px`,
        }));
    }
    for (let row = firstRow; row <= lastRow; row++) {
        rowHeads.push(head(String(row + 1), row === active.row, { top: `${row * ROW_HEIGHT}px` }));
        for (let col = firstCol; col <= lastCol; col++) {
            const shown = view.show(cellRef({ row, col }));
            if (!shown)
                continue;
            const cell = document.createElement("div");
            cell.className = `cell${shown.numeric ? " number" : ""}${shown.edited ? " edited" : ""}${shown.pending ? " formula-pending" : ""}`;
            cell.textContent = shown.text;
            cell.title = shown.pending ? "Calculated when the workbook is opened in Excel" : shown.text;
            Object.assign(cell.style, {
                left: `${columns.left(col)}px`,
                top: `${row * ROW_HEIGHT}px`,
                width: `${columns.width(col)}px`,
            });
            cells.push(cell);
        }
    }
    view.layer.replaceChildren(...cells);
    view.cols.replaceChildren(...colHeads);
    view.rows.replaceChildren(...rowHeads);
}
