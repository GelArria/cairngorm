import { describe, it, expect } from "vitest";
import { isImageExtension } from "@/common/filesystem/file-kinds";

describe("isImageExtension", () => {
  it("returns true for png", () => {
    expect(isImageExtension("png")).toBe(true);
  });

  it("returns true for jpg", () => {
    expect(isImageExtension("jpg")).toBe(true);
  });

  it("returns true for jpeg", () => {
    expect(isImageExtension("jpeg")).toBe(true);
  });

  it("returns true for gif", () => {
    expect(isImageExtension("gif")).toBe(true);
  });

  it("returns true for svg", () => {
    expect(isImageExtension("svg")).toBe(true);
  });

  it("returns true for webp", () => {
    expect(isImageExtension("webp")).toBe(true);
  });

  it("returns true for bmp", () => {
    expect(isImageExtension("bmp")).toBe(true);
  });

  it("returns true for ico", () => {
    expect(isImageExtension("ico")).toBe(true);
  });

  it("returns true for avif", () => {
    expect(isImageExtension("avif")).toBe(true);
  });

  it("returns false for ts", () => {
    expect(isImageExtension("ts")).toBe(false);
  });

  it("returns false for js", () => {
    expect(isImageExtension("js")).toBe(false);
  });

  it("returns false for md", () => {
    expect(isImageExtension("md")).toBe(false);
  });

  it("returns false for css", () => {
    expect(isImageExtension("css")).toBe(false);
  });

  it("returns false for py", () => {
    expect(isImageExtension("py")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isImageExtension("")).toBe(false);
  });

  it("is case insensitive for uppercase", () => {
    expect(isImageExtension("PNG")).toBe(true);
  });

  it("is case insensitive for mixed case", () => {
    expect(isImageExtension("JpG")).toBe(true);
  });

  it("strips leading dot", () => {
    expect(isImageExtension(".png")).toBe(true);
  });
});
