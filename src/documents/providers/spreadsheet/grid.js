// The worksheet view: frozen headers, a virtualized body, one active cell, in-place editing
// and keyboard navigation.
import { cellRef, parseRef } from "./cells.js";
import { renderView } from "./grid-render.js";
import { Columns, extent, ROW_HEIGHT } from "./layout.js";
const byId = (id) => document.getElementById(id);
export class Grid {
    constructor(source) {
        this.source = source;
        this.body = byId("body");
        this.canvas = byId("canvas");
        /** Cells only: redrawing never moves the editor, so typing keeps its focus. */
        this.layer = byId("cells");
        this.cols = byId("col-heads").firstElementChild;
        this.rows = byId("row-heads").firstElementChild;
        this.selection = byId("selection");
        this.editor = byId("editor");
        this.columns = new Columns(26, new Map());
        this.rowCount = 100;
        this.active = { row: 0, col: 0 };
        this.frame = 0;
        this.body.addEventListener("scroll", () => this.schedule());
        new ResizeObserver(() => this.schedule()).observe(this.body);
        this.body.addEventListener("mousedown", (event) => this.pointer(event));
        this.body.addEventListener("dblclick", () => this.edit());
        this.body.addEventListener("keydown", (event) => this.key(event));
        this.editor.addEventListener("keydown", (event) => this.editorKey(event));
        this.editor.addEventListener("blur", () => this.finish(true, null));
    }
    show(data) {
        const size = extent(data.rows, data.cols);
        this.columns = new Columns(size.cols, data.widths);
        this.rowCount = size.rows;
        this.canvas.style.width = `${this.columns.total}px`;
        this.canvas.style.height = `${this.rowCount * ROW_HEIGHT}px`;
        this.cols.style.width = `${this.columns.total}px`;
        this.body.scrollTo(0, 0);
        this.select({ row: 0, col: 0 });
    }
    get activeRef() {
        return cellRef(this.active);
    }
    focus() {
        this.body.focus({ preventScroll: true });
    }
    select(at) {
        this.active = {
            row: Math.max(0, Math.min(at.row, this.rowCount - 1)),
            col: Math.max(0, Math.min(at.col, this.columns.count - 1)),
        };
        const { row, col } = this.active;
        Object.assign(this.selection.style, {
            left: `${this.columns.left(col) - 1}px`,
            top: `${row * ROW_HEIGHT - 1}px`,
            width: `${this.columns.width(col) + 1}px`,
            height: `${ROW_HEIGHT + 1}px`,
        });
        this.reveal();
        this.render();
        this.source.selected(this.activeRef);
    }
    goTo(ref) {
        const at = parseRef(ref);
        if (at) {
            this.select(at);
            this.focus();
        }
    }
    /** Re-draws after edits or a reload without moving the view. */
    refresh() {
        this.render();
    }
    edit(initial) {
        if (!this.source.editable()) {
            return;
        }
        const { row, col } = this.active;
        Object.assign(this.editor.style, {
            left: `${this.columns.left(col) - 1}px`,
            top: `${row * ROW_HEIGHT - 1}px`,
            minWidth: `${this.columns.width(col) + 2}px`,
            width: `${Math.max(this.columns.width(col) + 2, 160)}px`,
        });
        this.editor.value = initial ?? this.source.input(this.activeRef);
        this.editor.hidden = false;
        this.editor.focus();
        this.editor.setSelectionRange(this.editor.value.length, this.editor.value.length);
    }
    finish(save, move) {
        if (this.editor.hidden) {
            return;
        }
        this.editor.hidden = true;
        if (save) {
            this.source.commit(this.activeRef, this.editor.value);
        }
        this.render();
        if (move) {
            this.select(move);
        }
        this.focus();
    }
    editorKey(event) {
        const { row, col } = this.active;
        if (event.key === "Enter") {
            event.preventDefault();
            this.finish(true, { row: row + (event.shiftKey ? -1 : 1), col });
        }
        else if (event.key === "Tab") {
            event.preventDefault();
            this.finish(true, { row, col: col + (event.shiftKey ? -1 : 1) });
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            this.finish(false, null);
        }
    }
    key(event) {
        if (event.target !== this.body) {
            return;
        }
        const { row, col } = this.active;
        const page = Math.max(1, Math.floor(this.body.clientHeight / ROW_HEIGHT) - 1);
        const moves = {
            ArrowUp: { row: row - 1, col },
            ArrowDown: { row: row + 1, col },
            ArrowLeft: { row, col: col - 1 },
            ArrowRight: { row, col: col + 1 },
            PageUp: { row: row - page, col },
            PageDown: { row: row + page, col },
            Home: { row: event.ctrlKey ? 0 : row, col: 0 },
            Tab: { row, col: col + (event.shiftKey ? -1 : 1) },
            Enter: { row: row + (event.shiftKey ? -1 : 1), col },
        };
        if (event.key === "F2" || (event.key === "Enter" && event.altKey)) {
            event.preventDefault();
            this.edit();
        }
        else if (moves[event.key]) {
            event.preventDefault();
            this.select(moves[event.key]);
        }
        else if ((event.key === "Delete" || event.key === "Backspace") && this.source.editable()) {
            event.preventDefault();
            this.source.commit(this.activeRef, "");
            this.render();
        }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            this.edit(event.key);
        }
    }
    pointer(event) {
        if (event.button !== 0 || event.target === this.editor) {
            return;
        }
        const bounds = this.canvas.getBoundingClientRect();
        const row = Math.floor((event.clientY - bounds.top) / ROW_HEIGHT);
        this.finish(true, null);
        this.select({ row, col: this.columns.at(event.clientX - bounds.left) });
    }
    reveal() {
        const { row, col } = this.active;
        const top = row * ROW_HEIGHT;
        const left = this.columns.left(col);
        const b = this.body;
        if (top < b.scrollTop)
            b.scrollTop = top;
        if (top + ROW_HEIGHT > b.scrollTop + b.clientHeight)
            b.scrollTop = top + ROW_HEIGHT - b.clientHeight;
        if (left < b.scrollLeft)
            b.scrollLeft = left;
        const right = left + this.columns.width(col);
        if (right > b.scrollLeft + b.clientWidth)
            b.scrollLeft = right - b.clientWidth;
    }
    schedule() {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.render());
    }
    render() {
        renderView({
            body: this.body,
            layer: this.layer,
            cols: this.cols,
            rows: this.rows,
            columns: this.columns,
            rowCount: this.rowCount,
            active: this.active,
            show: (ref) => this.source.show(ref),
        });
    }
}
