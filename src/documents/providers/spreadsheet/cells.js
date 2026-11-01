// A1-style addresses. Rows and columns are zero-based inside the editor.
export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;
export function columnName(col) {
    let name = "";
    for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
}
export function cellRef({ row, col }) {
    return `${columnName(col)}${row + 1}`;
}
/** `null` for anything that is not a single in-range cell like "B12" (absolute "$B$12" accepted). */
export function parseRef(ref) {
    const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
    if (!match) {
        return null;
    }
    let col = 0;
    for (const letter of match[1].toUpperCase()) {
        col = col * 26 + letter.charCodeAt(0) - 64;
    }
    const row = Number(match[2]);
    if (row < 1 || row > MAX_ROWS || col > MAX_COLS) {
        return null;
    }
    return { row: row - 1, col: col - 1 };
}
/** "A1:C5" or a single cell; corners are normalized to top-left / bottom-right. */
export function parseRange(range) {
    const [first, second = first] = range.split(":");
    const a = parseRef(first);
    const b = parseRef(second);
    if (!a || !b) {
        return null;
    }
    return {
        start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
        end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
    };
}
