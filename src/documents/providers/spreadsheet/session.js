// One open workbook: the parsed package, the sheet on screen and the unsaved inputs.
import { cellRef, parseRange, parseRef } from "./cells.js";
import { parseInput, saveWorkbook } from "./edits.js";
import { lockedReason } from "./protect.js";
import { inputProblem } from "./rules.js";
import { readSheet, readWorkbook } from "./workbook.js";
const MAX_READ_CELLS = 10000;
const MAX_SET_CELLS = 1000;
export class SheetSession {
    constructor() {
        this.index = 0;
        this.edits = new Map();
        /** Inputs the save in flight writes; null when no save is running. */
        this.saving = null;
        this.pendingBytes = null;
    }
    async load(bytes) {
        this.book = await readWorkbook(bytes);
        this.edits = new Map();
        await this.open(Math.min(this.index, this.book.sheets.length - 1));
    }
    async open(index) {
        this.data = await readSheet(this.book, index);
        this.index = index;
    }
    get pending() {
        let count = 0;
        for (const changes of this.edits.values())
            count += changes.size;
        return count;
    }
    show(ref, data = this.data, index = this.index) {
        const edited = this.edits.get(index)?.get(ref);
        if (edited !== undefined) {
            const input = parseInput(edited);
            return {
                text: edited,
                numeric: input.kind === "number",
                edited: true,
                pending: input.kind === "formula",
            };
        }
        const cell = data.cells.get(ref);
        return cell
            ? { text: cell.display, numeric: cell.numeric, edited: false, pending: false }
            : null;
    }
    input(ref) {
        return this.edits.get(this.index)?.get(ref) ?? this.data.cells.get(ref)?.input ?? "";
    }
    /** Why `input` cannot go into `ref`, or null. */
    problem(ref, input, data = this.data) {
        const at = parseRef(ref);
        if (!at)
            return `${ref} is not a cell reference.`;
        if (data.cells.get(ref)?.anchored) {
            return `${ref} anchors a shared or array formula other cells use. Edit it in Excel.`;
        }
        const locked = lockedReason(data.locked, at);
        if (locked)
            return `${ref} ${locked}. Edit it in Excel.`;
        const problem = inputProblem(input);
        return problem && `${ref}: ${problem}`;
    }
    /** Records an input; a message explains a refusal. */
    commit(ref, input, data = this.data, index = this.index) {
        const refusal = this.problem(ref, input, data);
        if (refusal)
            return refusal;
        let changes = this.edits.get(index);
        if (!changes) {
            changes = new Map();
            this.edits.set(index, changes);
        }
        // While a save runs, the file is about to hold what that save covers.
        const covered = this.saving?.get(index)?.get(ref);
        const baseline = covered ?? data.cells.get(ref)?.input ?? "";
        if (input === baseline && covered === undefined) {
            changes.delete(ref);
        }
        else {
            changes.set(ref, input);
        }
        return null;
    }
    sheetIndex(sheet) {
        if (sheet === undefined || sheet === null || sheet === "")
            return this.index;
        const index = typeof sheet === "number"
            ? sheet
            : this.book.sheets.findIndex((s) => s.name === String(sheet));
        if (!this.book.sheets[index])
            throw new Error(`No worksheet named ${String(sheet)}.`);
        return index;
    }
    async sheetData(index) {
        return index === this.index ? this.data : readSheet(this.book, index);
    }
    /** Values as shown (unsaved inputs included), for agents. */
    async readRange(sheet, range) {
        const index = this.sheetIndex(sheet);
        const area = parseRange(String(range ?? ""));
        if (!area)
            throw new Error('Give a range like "A1:D20".');
        const height = area.end.row - area.start.row + 1;
        const width = area.end.col - area.start.col + 1;
        if (height * width > MAX_READ_CELLS)
            throw new Error(`Read at most ${MAX_READ_CELLS} cells at a time.`);
        const data = await this.sheetData(index);
        const values = [];
        for (let row = area.start.row; row <= area.end.row; row++) {
            const line = [];
            for (let col = area.start.col; col <= area.end.col; col++) {
                line.push(this.show(cellRef({ row, col }), data, index)?.text ?? "");
            }
            values.push(line);
        }
        return { sheet: this.book.sheets[index].name, range: String(range).toUpperCase(), values };
    }
    /** Sets cells like typing them; strings starting with "=" are formulas. All or nothing. */
    async setCells(sheet, cells) {
        const index = this.sheetIndex(sheet);
        if (!cells || typeof cells !== "object" || Array.isArray(cells)) {
            throw new Error('Give cells as an object like { "B2": 5, "C2": "=B2*2" }.');
        }
        const entries = Object.entries(cells);
        if (entries.length > MAX_SET_CELLS)
            throw new Error(`Set at most ${MAX_SET_CELLS} cells at a time.`);
        const data = await this.sheetData(index);
        const inputs = entries.map(([ref, value]) => {
            const at = parseRef(ref);
            if (!at)
                throw new Error(`${ref} is not a cell reference.`);
            const input = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value ?? "");
            return [cellRef(at), input];
        });
        for (const [ref, input] of inputs) {
            const refusal = this.problem(ref, input, data);
            if (refusal)
                throw new Error(refusal);
        }
        for (const [ref, input] of inputs)
            this.commit(ref, input, data, index);
        return { sheet: this.book.sheets[index].name, changed: inputs.length };
    }
    /** The workbook with every pending input written; remembers what this save covers. */
    async serialize() {
        const saving = new Map([...this.edits].map(([index, changes]) => [index, new Map(changes)]));
        this.saving = saving;
        try {
            this.pendingBytes = await saveWorkbook(this.book, saving);
        }
        catch (error) {
            this.saving = null;
            throw error;
        }
        return this.pendingBytes;
    }
    /** After Cairngorm committed the save: inputs typed meanwhile stay pending. */
    async saved() {
        const covered = this.saving;
        const bytes = this.pendingBytes;
        this.pendingBytes = null;
        if (!covered || !bytes) {
            this.saving = null;
            return;
        }
        try {
            const book = await readWorkbook(bytes);
            let index = this.index;
            let data = await readSheet(book, index);
            while (index !== this.index) {
                index = this.index;
                data = await readSheet(book, index);
            }
            // Computed only now, so inputs committed while re-reading are kept.
            const remaining = new Map();
            for (const [sheet, changes] of this.edits) {
                for (const [ref, input] of changes) {
                    if (covered.get(sheet)?.get(ref) !== input) {
                        if (!remaining.has(sheet))
                            remaining.set(sheet, new Map());
                        remaining.get(sheet).set(ref, input);
                    }
                }
            }
            this.book = book;
            this.data = data;
            this.edits = remaining;
        }
        finally {
            this.saving = null;
        }
    }
}
