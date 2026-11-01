import { describe, it, expect } from "vitest";
import { getExtension } from "@/workspace/model/file-contents";
import { useFileContents } from "@/workspace/hooks/use-file-contents";
import { renderHook, act } from "@testing-library/preact";

describe("getExtension", () => {
  it("returns correct extension for simple filename", () => {
    expect(getExtension("index.ts")).toBe("ts");
  });

  it("returns correct extension for markdown", () => {
    expect(getExtension("README.md")).toBe("md");
  });

  it("handles no extension", () => {
    expect(getExtension("Makefile")).toBe("");
  });

  it("handles multiple dots", () => {
    expect(getExtension("app.test.ts")).toBe("ts");
    expect(getExtension("Review.final.DOCX")).toBe("docx");
  });

  it("returns lowercase extension", () => {
    expect(getExtension("Component.TSX")).toBe("tsx");
  });

  it("handles hidden files with extension", () => {
    expect(getExtension(".gitignore")).toBe("gitignore");
  });
});

describe("useFileContents", () => {
  it("getContent returns empty string for missing key", () => {
    const { result } = renderHook(() => useFileContents());
    const content = result.current.getContent(["nonexistent", "file.ts"]);
    expect(content).toBe("");
  });

  it("setContent adds new content", () => {
    const { result } = renderHook(() => useFileContents());
    act(() => result.current.setContent(["new-file.ts"], "hello world"));
    expect(result.current.getContent(["new-file.ts"])).toBe("hello world");
  });

  it("setContent overwrites existing content", () => {
    const { result } = renderHook(() => useFileContents());
    act(() => result.current.setContent(["test.md"], "updated"));
    expect(result.current.getContent(["test.md"])).toBe("updated");
  });

  it("moves a file's content to its new path", () => {
    const { result } = renderHook(() => useFileContents());
    act(() => result.current.setContent(["move.ts"], "keep this"));
    act(() => result.current.moveContent(["move.ts"], ["src", "move.ts"]));
    expect(result.current.getContent(["src", "move.ts"])).toBe("keep this");
    expect(result.current.getContent(["move.ts"])).toBe("");
  });

  it("moves nested contents without touching a similarly named folder", () => {
    const { result } = renderHook(() => useFileContents());
    act(() => {
      result.current.setContent(["old", "nested", "a.txt"], "nested");
      result.current.setContent(["older", "b.txt"], "untouched");
    });
    act(() => result.current.moveContent(["old"], ["src", "old"]));
    expect(result.current.getContent(["src", "old", "nested", "a.txt"])).toBe("nested");
    expect(result.current.getContent(["old", "nested", "a.txt"])).toBe("");
    expect(result.current.getContent(["older", "b.txt"])).toBe("untouched");
  });
});
