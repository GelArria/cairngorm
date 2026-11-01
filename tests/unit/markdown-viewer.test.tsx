import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/preact";
import { MarkdownViewer, NotebookViewer } from "@/editor/file-preview";

afterEach(cleanup);

function preview(content: string) {
  return render(<MarkdownViewer content={content} />).container;
}

const table = [
  "| Name | Value | Note |",
  "| :--- | ---: | :---: |",
  "| **One** | 42 | a\\|b |",
  "| *Two* | 7 | `a\\|b` |",
].join("\n");

describe("Markdown file reader", () => {
  it("renders GFM tables with alignment, formatting and escaped pipes", () => {
    const root = preview(table);
    expect(root.querySelectorAll("table")).toHaveLength(1);
    expect(root.querySelectorAll("thead th")).toHaveLength(3);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.querySelector("tbody strong")?.textContent).toBe("One");
    expect(root.querySelector("tbody em")?.textContent).toBe("Two");
    expect(root.querySelector("tbody tr td:last-child")?.textContent).toBe("a|b");
    expect(root.querySelector("tbody code")?.textContent).toBe("a|b");
    expect(root.querySelector("thead th:nth-child(2)")?.getAttribute("align")).toBe("right");
  });

  it("accepts tables without outer pipes and preserves unfinished code fences", () => {
    const root = preview("Name | Value\n--- | ---\nOne | 1\n\n```ts\nconst value = '**literal**';");
    expect(root.querySelectorAll("table tbody td")).toHaveLength(2);
    expect(root.querySelector("pre code")?.textContent).toBe("const value = '**literal**';\n");
    expect(root.querySelector("pre strong")).toBeNull();
  });

  it("keeps code literal and parses nested emphasis, escapes and strikethrough", () => {
    const root = preview(
      "***combined*** and ~~removed~~ and \\*literal\\* and `**unformatted** <tag>` and ``a ` b``",
    );
    expect(root.querySelector("strong em, em strong")?.textContent).toBe("combined");
    expect(root.querySelector("del")?.textContent).toBe("removed");
    expect(root.textContent).toContain("*literal*");
    expect(root.querySelectorAll("code")[0]?.textContent).toBe("**unformatted** <tag>");
    expect(root.querySelectorAll("code")[1]?.textContent).toBe("a ` b");
    expect(root.querySelector("code strong")).toBeNull();
  });

  it("renders nested ordered lists, blockquotes, task lists and thematic breaks", () => {
    const root = preview(
      "1. First\n   - Child\n2. Second\n\n> A **quote**\n\n- [x] Done\n- [ ] Pending\n\n---",
    );
    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(root.querySelector("ol ul li")?.textContent).toBe("Child");
    expect(root.querySelector("blockquote strong")?.textContent).toBe("quote");
    const tasks = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].checked).toBe(true);
    expect(tasks[1].checked).toBe(false);
    expect(Array.from(tasks).every((task) => task.disabled)).toBe(true);
    expect(root.querySelector("hr")).not.toBeNull();
  });

  it("handles CRLF, setext headings, multiline paragraphs and both fence styles", () => {
    const root = preview(
      "Title\r\n=====\r\n\r\nOne line\r\nand another.\r\n\r\n~~~ts\r\nconst x = '**literal**';\r\n~~~\r\n\r\n````\r\n```\r\n````",
    );
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.querySelectorAll("pre code")[0]?.textContent).toBe("const x = '**literal**';\n");
    expect(root.querySelectorAll("pre code")[1]?.textContent).toBe("```\n");
    expect(root.querySelector("pre strong")).toBeNull();
  });

  it("renders reference links, autolinks, entities and parentheses safely", () => {
    const root = preview(
      '[guide][doc] and <https://example.com> and &amp;\n\n[doc]: https://example.com/a_(b) "Guide"',
    );
    const link = root.querySelector("a");
    expect(link?.textContent).toBe("guide");
    expect(link?.getAttribute("href")).toBe("https://example.com/a_(b)");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(root.querySelectorAll("a")).toHaveLength(2);
    expect(root.textContent).toContain(" and &");
  });

  it("blocks active HTML and unsafe URL schemes", () => {
    const root = preview(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert%281%29) ![bad](data:text/html,bad)\n\n[ok](https://example.com/?q=%22)',
    );
    expect(root.querySelector("script, iframe, object, svg, [onerror], [onclick]")).toBeNull();
    expect(root.querySelector('[href^="javascript:"], [src^="data:"]')).toBeNull();
    expect(root.querySelector('a[href^="https:"]')?.textContent).toBe("ok");
  });

  it("updates the preview when content changes and keeps the existing size limit", () => {
    const { container, rerender } = render(<MarkdownViewer content="# Before" />);
    rerender(<MarkdownViewer content="# After" />);
    expect(container.querySelector("h1")?.textContent).toBe("After");
    rerender(<MarkdownViewer content={"x".repeat(200_000) + "OMITTED"} />);
    expect(container.textContent).not.toContain("OMITTED");
  });

  it("uses the same table renderer in notebook markdown cells", () => {
    const { container } = render(
      <NotebookViewer
        content={JSON.stringify({ cells: [{ cell_type: "markdown", source: table }] })}
      />,
    );
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(2);
  });
});
