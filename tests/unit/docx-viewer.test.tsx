import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocxViewer } from "@/editor/components/preview/docx-viewer";
import { docxFixture, PARAGRAPH, WORD_XML } from "../fixtures/docx";

const renderAsync = vi.hoisted(() => vi.fn());
vi.mock("docx-preview", () => ({ renderAsync }));
const source = async (text = "Preview") =>
  `data:application/zip;base64,${Buffer.from(await docxFixture({ extra: { "word/document.xml": WORD_XML(PARAGRAPH(text)) } })).toString("base64")}`;
function frame() {
  return screen.getByTitle("Document: review.docx") as HTMLIFrameElement;
}
function load() {
  fireEvent.load(frame());
}

beforeEach(() => {
  renderAsync.mockReset();
  renderAsync.mockImplementation(async (_data, body) => {
    body.textContent = "Rendered document";
  });
});
afterEach(cleanup);

describe("DOCX viewer lifecycle", () => {
  it("loads an internal script-disabled frame and exposes truthful read-only status", async () => {
    render(<DocxViewer src={await source()} title="review.docx" />);
    load();
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(frame().style.visibility).toBe("visible"));
    expect(frame().getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame().srcdoc).toContain("default-src 'none'");
    expect(frame().srcdoc).toContain("img-src data:");
    expect(screen.getByText("DOCX · Read-only preview")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save|external/i })).toBeNull();
    expect(renderAsync.mock.calls[0][3]).toMatchObject({
      renderAltChunks: false,
      ignoreFonts: true,
      useBase64URL: true,
    });
  });
  it("removes hyperlink navigation after rendering", async () => {
    renderAsync.mockImplementation(async (_data, body) => {
      body.innerHTML = '<a href="javascript:alert(1)">Reference</a>';
    });
    render(<DocxViewer src={await source()} title="review.docx" />);
    load();
    await waitFor(() => expect(frame().style.visibility).toBe("visible"));
    expect(frame().contentDocument!.querySelector("a")!.hasAttribute("href")).toBe(false);
  });
  it("reports archive errors without calling the renderer or exposing partial content", async () => {
    render(<DocxViewer src="data:application/zip;base64,bm90IGEgemlw" title="review.docx" />);
    load();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("archive"));
    expect(renderAsync).not.toHaveBeenCalled();
    expect(frame().style.visibility).toBe("hidden");
  });
  it("reports native permission and size failures instead of an endless loader", () => {
    render(<DocxViewer title="review.docx" readError="Permission denied" />);
    expect(screen.getByRole("alert").textContent).toContain("Permission denied");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("recovers from a corrupt source when a valid source arrives", async () => {
    const view = render(<DocxViewer src="data:application/zip;base64,eA==" title="review.docx" />);
    load();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    view.rerender(<DocxViewer src={await source()} title="review.docx" />);
    await waitFor(() => expect(frame().style.visibility).toBe("visible"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not let an older render replace a newer document", async () => {
    let complete!: () => void;
    renderAsync.mockImplementationOnce(
      (_data, body) =>
        new Promise<void>((resolve) => {
          complete = () => {
            body.textContent = "Old document";
            resolve();
          };
        }),
    );
    const view = render(<DocxViewer src={await source("Old")} title="review.docx" />);
    load();
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(1));
    view.rerender(<DocxViewer src={await source("New")} title="review.docx" />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(frame().style.visibility).toBe("visible"));
    complete();
    await Promise.resolve();
    expect(frame().contentDocument!.body.textContent).toBe("Rendered document");
  });
  it("discards a late render failure after unmount", async () => {
    let fail!: (error: Error) => void;
    renderAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const view = render(<DocxViewer src={await source()} title="review.docx" />);
    load();
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(1));
    view.unmount();
    fail(new Error("Late failure"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
