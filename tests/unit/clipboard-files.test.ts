import { describe, it, expect } from "vitest";
import { clipboardImageName, processClipboardFile } from "@/common/filesystem/clipboard-files";

// Minimal 1x1 PNG as Uint8Array
const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makePngFile(name: string): File {
  return new File([PNG_HEADER], name, { type: "image/png" });
}

describe("clipboard-files", () => {
  it("clipboardImageName returns file.name when present", () => {
    const file = makePngFile("screenshot.png");
    expect(clipboardImageName(file)).toBe("screenshot.png");
  });

  it("clipboardImageName generates name from type when name is empty", () => {
    const file = new File([PNG_HEADER], "", { type: "image/png" });
    const name = clipboardImageName(file);
    expect(name).toMatch(/^clipboard-image-\d+\.png$/);
  });

  it("processClipboardFile converts image File to data URL", async () => {
    const file = makePngFile("test.png");
    const result = await processClipboardFile(file);
    expect(result.name).toBe("test.png");
    expect(result.ext).toBe("png");
    expect(result.isImage).toBe(true);
    expect(result.imageSrc).toMatch(/^data:image\/png;base64,/);
    expect(result.content).toBe("");
  });

  it("processClipboardFile reads text files", async () => {
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    const result = await processClipboardFile(file);
    expect(result.name).toBe("notes.txt");
    expect(result.ext).toBe("txt");
    expect(result.isImage).toBe(false);
    expect(result.content).toBe("hello world");
    expect(result.imageSrc).toBeUndefined();
  });

  it("processClipboardFile handles unnamed clipboard images", async () => {
    const file = new File([PNG_HEADER], "", { type: "image/png" });
    const result = await processClipboardFile(file);
    expect(result.name).toMatch(/^clipboard-image-\d+\.png$/);
    expect(result.isImage).toBe(true);
    expect(result.imageSrc).toMatch(/^data:image\/png;base64,/);
  });

  it("processClipboardFile returns binary placeholder for unknown binary", async () => {
    const file = new File([new ArrayBuffer(2048)], "data.bin", {
      type: "application/octet-stream",
    });
    const result = await processClipboardFile(file);
    expect(result.name).toBe("data.bin");
    expect(result.content).toMatch(/^\[Binary:/);
    expect(result.isImage).toBe(false);
  });
});
