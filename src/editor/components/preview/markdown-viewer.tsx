import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";
import { useMemo } from "preact/hooks";
import { PREVIEW_MAX_MARKDOWN_CHARS } from "./limits";

export function esc(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function markdownHtml(source: string): string {
  return DOMPurify.sanitize(markdown.parse(source, { async: false }), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
  });
}

export function MarkdownViewer({ content }: { content: string }) {
  const source =
    content.length > PREVIEW_MAX_MARKDOWN_CHARS
      ? content.slice(0, PREVIEW_MAX_MARKDOWN_CHARS)
      : content;
  const html = useMemo(() => markdownHtml(source), [source]);
  return (
    <article
      data-testid="markdown-viewer"
      class="file-preview markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
const markdown = new Marked({
  gfm: true,
  renderer: {
    // File content is untrusted: show raw HTML as text, never as app markup.
    html({ text }) {
      return esc(text);
    },
    link(token) {
      return Renderer.prototype.link
        .call(this, token)
        .replace("<a ", '<a target="_blank" rel="noopener noreferrer" ');
    },
    table(token) {
      return `<div class="markdown-table" tabindex="0" role="region" aria-label="Markdown table">${Renderer.prototype.table.call(this, token)}</div>`;
    },
    image(token) {
      if (/^(?:data|file):/i.test(token.href.replace(/[\u0000-\u0020]/g, ""))) {
        return esc(token.text);
      }
      return Renderer.prototype.image.call(this, token);
    },
  },
});
