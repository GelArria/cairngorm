// Keep the webview from behaving like a browser page: the PAGE right-click menu
// (Back / Refresh / Save as / Print / Inspect) never opens, and in
// production builds neither do the reload shortcuts that would throw away
// every live terminal. Text fields keep the standard Windows menu (Cut / Copy /
// Paste / Select all). The app's own context menus keep working — they run from
// the same `contextmenu` event and only need it to reach them.
// Dev builds keep Shift + right-click (native menu → Inspect) and F5 / Ctrl+R.

/** Where typing happens: the normal Windows edit menu is useful there. */
const EDITABLE = [
  "textarea:not(.xterm-helper-textarea)",
  // text-like inputs only (not checkbox / radio / button / submit / file / range / color …)
  "input:not([type])",
  ...[
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
  ].map((t) => `input[type="${t}"]`),
  '[contenteditable=""]',
  '[contenteditable="true"]',
  ".cm-content",
].join(",");

/** True inside a text field — those keep the standard Windows edit menu. */
export const isEditable = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(EDITABLE);

/** Terminal input belongs to the shell/TUI, not the surrounding web app. */
export const isTerminalInput = (t: EventTarget | null) =>
  !!(t as Element | null)?.closest?.(".xterm");
