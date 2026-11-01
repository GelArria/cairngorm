import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const panelHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  { tag: tags.controlKeyword, color: "var(--syntax-keyword)" },
  { tag: tags.name, color: "hsl(var(--foreground))" },
  { tag: tags.variableName, color: "hsl(var(--foreground))" },
  { tag: tags.typeName, color: "var(--syntax-type)" },
  { tag: tags.tagName, color: "var(--syntax-type)" },
  { tag: tags.propertyName, color: "hsl(var(--foreground))" },
  { tag: tags.attributeName, color: "var(--syntax-keyword)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.bool, color: "var(--syntax-number)" },
  { tag: tags.null, color: "var(--syntax-keyword)" },
  { tag: tags.comment, color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: tags.operator, color: "hsl(var(--muted-foreground))" },
  { tag: tags.punctuation, color: "hsl(var(--muted-foreground))" },
  { tag: tags.bracket, color: "hsl(var(--muted-foreground))" },
  { tag: tags.meta, color: "hsl(var(--muted-foreground))" },
  { tag: tags.definition(tags.variableName), color: "var(--syntax-function)" },
  { tag: tags.function(tags.variableName), color: "var(--syntax-function)" },
  { tag: tags.className, color: "var(--syntax-type)" },
  { tag: tags.labelName, color: "var(--syntax-keyword)" },
  { tag: tags.special(tags.string), color: "var(--syntax-string)" },
  { tag: tags.heading, color: "var(--syntax-keyword)", fontWeight: "700" },
  { tag: tags.emphasis, color: "hsl(var(--foreground))", fontStyle: "italic" },
  { tag: tags.strong, color: "hsl(var(--foreground))", fontWeight: "700" },
  { tag: tags.link, color: "var(--syntax-function)", textDecoration: "underline" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "hsl(var(--muted-foreground))",
  },
  { tag: tags.inserted, color: "var(--syntax-string)" },
  { tag: tags.deleted, color: "var(--syntax-deleted)" },
  { tag: tags.changed, color: "var(--syntax-number)" },
]);

export const editorTheme = EditorView.theme({
  "&": {
    fontSize: "12px",
    height: "100%",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  },
  ".cm-content": {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    caretColor: "hsl(var(--foreground))",
    lineHeight: "1.5",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--foreground))",
    borderLeftWidth: "1.5px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "hsl(var(--accent)) !important",
  },
  ".cm-gutters": {
    background: "hsl(var(--background))",
    color: "hsl(var(--muted-foreground))",
    border: "none",
    minWidth: "2.2em",
  },
  ".cm-activeLineGutter": {
    background: "hsl(var(--secondary))",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-activeLine": {
    background: "hsl(var(--secondary))",
  },
  ".cm-line": {
    padding: "0 4px",
  },
  ".cm-foldGutter": {
    width: "1.2em",
  },
  ".cm-selectionMatch": {
    background: "hsl(var(--accent))",
  },
  ".cm-searchMatch": {
    background: "hsl(var(--primary)) !important",
    color: "hsl(var(--primary-foreground)) !important",
    borderRadius: "2px",
    outline: "2px solid hsl(var(--ring)) !important",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "hsl(var(--primary)) !important",
    color: "hsl(var(--primary-foreground)) !important",
    outline: "2px solid hsl(var(--foreground)) !important",
  },
  ".cm-matchingBracket": {
    background: "hsl(var(--accent))",
    outline: "1px solid hsl(var(--ring))",
    color: "hsl(var(--foreground)) !important",
  },
  ".cm-nonmatchingBracket": {
    background: "hsl(var(--destructive) / .1)",
    color: "hsl(var(--destructive)) !important",
  },
  ".cm-tooltip": {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    color: "hsl(var(--foreground))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    color: "hsl(var(--foreground))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "hsl(var(--accent))",
    color: "hsl(var(--foreground))",
  },
  ".cm-panels": {
    background: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
    borderColor: "hsl(var(--border))",
  },
  ".cm-search": { fontFamily: "inherit", fontSize: "12px" },
  ".cm-search button[name=close]": { width: "24px", height: "24px", color: "inherit" },
  ".cm-textfield, .cm-button": {
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "4px",
    font: "inherit",
  },
  ".cm-button": { backgroundImage: "none", cursor: "pointer" },
  ".cm-textfield:focus-visible, .cm-button:focus-visible": {
    outline: "2px solid hsl(var(--ring))",
  },
  ".cm-foldPlaceholder": {
    background: "hsl(var(--secondary))",
    border: "none",
    color: "hsl(var(--muted-foreground))",
  },
});
