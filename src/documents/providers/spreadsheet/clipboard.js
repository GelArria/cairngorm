// Tab-separated text as Excel and browsers put it on the clipboard. A cell that holds tabs,
// line breaks or quotes is wrapped in quotes with inner quotes doubled.
export function parseTsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let i = 0;
    const source = text.replace(/\r?\n$/, "");
    while (i < source.length) {
        const char = source[i];
        if (quoted) {
            if (char === '"' && source[i + 1] === '"') {
                cell += '"';
                i += 2;
                continue;
            }
            if (char === '"')
                quoted = false;
            else
                cell += char;
        }
        else if (char === '"' && cell === "") {
            quoted = true;
        }
        else if (char === "\t") {
            row.push(cell);
            cell = "";
        }
        else if (char === "\n" || char === "\r") {
            if (char === "\r" && source[i + 1] === "\n")
                i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else {
            cell += char;
        }
        i++;
    }
    row.push(cell);
    rows.push(row);
    return rows;
}
