// Cairngorm's spreadsheet editor: shows and edits .xlsx workbooks inside a pane. Saving goes
// through Cairngorm (version check, backup, atomic replace); agents use declared operations.
import { connect } from "./_cairngorm/document-sdk.js";
import { cellRef, parseRef } from "./cells.js";
import { parseTsv } from "./clipboard.js";
import { Grid } from "./grid.js";
import { SheetSession } from "./session.js";
const byId = (id) => document.getElementById(id);
const name = byId("name");
const formula = byId("formula");
const tabs = byId("tabs");
const status = byId("status");
const body = byId("body");
const session = new SheetSession();
let host;
let notice = "";
function applyTheme(context) {
    const style = document.documentElement.style;
    style.colorScheme = context.theme ?? "light";
    const colors = context.colors ?? {};
    for (const [key, token] of [
        ["background", "--background"],
        ["foreground", "--foreground"],
        ["mutedForeground", "--muted"],
        ["border", "--border"],
        ["accent", "--accent"],
    ]) {
        if (colors[key])
            style.setProperty(token, colors[key]);
    }
}
function updateStatus() {
    const pending = session.pending;
    status.textContent =
        notice ||
            (!host.capabilities.edit
                ? "Read-only"
                : pending
                    ? `${pending} unsaved ${pending === 1 ? "change" : "changes"}`
                    : "All changes saved");
}
/** Every edit path (cell editor, formula bar, paste, agents) ends here. */
function changed(refusal = null) {
    notice = refusal ?? "";
    host.setDirty(session.pending > 0);
    formula.value = session.input(grid.activeRef);
    grid.refresh();
    updateStatus();
}
const grid = new Grid({
    show: (ref) => session.show(ref),
    input: (ref) => session.input(ref),
    editable: () => host.capabilities.edit,
    commit(ref, input) {
        const refusal = session.commit(ref, input);
        changed(refusal);
        return refusal;
    },
    selected(ref) {
        name.value = ref;
        formula.value = session.input(ref);
        formula.readOnly = !host.capabilities.edit;
        notice = "";
        updateStatus();
    },
});
function renderTabs() {
    tabs.replaceChildren(...session.book.sheets.map((sheet, index) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(index === session.index));
        tab.textContent = sheet.name;
        tab.addEventListener("click", () => void openSheet(index));
        return tab;
    }));
}
async function openSheet(index) {
    await session.open(index);
    renderTabs();
    grid.show(session.data);
    grid.focus();
}
async function load() {
    await session.load(await host.read());
    renderTabs();
    grid.show(session.data);
    host.setDirty(false);
    updateStatus();
}
name.addEventListener("keydown", (event) => {
    if (event.key === "Enter")
        grid.goTo(name.value);
    if (event.key === "Escape")
        grid.focus();
});
formula.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && host.capabilities.edit) {
        event.preventDefault();
        changed(session.commit(grid.activeRef, formula.value));
        grid.focus();
    }
    else if (event.key === "Escape") {
        formula.value = session.input(grid.activeRef);
        grid.focus();
    }
});
// Copy the active cell's contents; paste tab-separated rows (from Excel or a table) from it.
document.addEventListener("copy", (event) => {
    if (document.activeElement !== body)
        return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", session.input(grid.activeRef));
});
document.addEventListener("paste", (event) => {
    if (document.activeElement !== body || !host.capabilities.edit)
        return;
    event.preventDefault();
    const origin = parseRef(grid.activeRef);
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const cells = {};
    parseTsv(text).forEach((line, r) => line.forEach((value, c) => {
        cells[cellRef({ row: origin.row + r, col: origin.col + c })] = value;
    }));
    void session.setCells(session.index, cells).then(() => changed(), (error) => changed(error.message));
});
async function main() {
    host = await connect();
    applyTheme(host.context);
    host.onContextChange(applyTheme);
    try {
        if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
            throw new Error("This system's web view is too old to open workbooks here.");
        }
        await load();
    }
    catch (error) {
        host.reportError(error);
        return;
    }
    byId("loading").hidden = true;
    byId("app").hidden = false;
    grid.show(session.data);
    grid.focus();
    host.ready();
    host.onDocumentChange(() => void load().catch((error) => host.reportError(error)));
    host.onSave(() => session.serialize());
    host.onSaved(async () => {
        try {
            await session.saved();
        }
        catch (error) {
            // The file was saved; only re-reading it here failed.
            host.reportError(error);
        }
        finally {
            changed();
        }
    });
    host.onOperation("list-sheets", () => ({
        sheets: session.book.sheets.map((sheet, index) => ({ index, name: sheet.name })),
        active: session.book.sheets[session.index].name,
    }));
    host.onOperation("read-range", (args) => session.readRange(args.sheet, args.range));
    host.onOperation("set-cells", async (args) => {
        if (!host.capabilities.edit) {
            throw new Error("This workbook is open read-only.");
        }
        try {
            return await session.setCells(args.sheet, args.cells);
        }
        finally {
            changed();
        }
    });
}
void main();
