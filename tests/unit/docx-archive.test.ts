import { describe, expect, it } from "vitest";
import { validateDocx, decodeDocxSource } from "@/editor/model/docx-archive";
import { docxFixture, zipFixture, WORD_XML } from "../fixtures/docx";

const bytes = (data: Uint8Array) =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

describe("DOCX archive boundary", () => {
  it.each(["STORE", "DEFLATE"] as const)(
    "accepts a bounded %s document with Unicode, table and PNG",
    async (compression) => {
      await expect(
        validateDocx(bytes(await docxFixture({ compression }))),
      ).resolves.toBeUndefined();
    },
  );
  it.each([new Uint8Array(), new Uint8Array([0x50, 0x4b, 3, 4]), new Uint8Array(40)])(
    "rejects malformed or truncated archives",
    async (data) => {
      await expect(validateDocx(bytes(data))).rejects.toThrow(/archive/i);
    },
  );
  it("rejects packages without a Word document", async () => {
    await expect(
      validateDocx(bytes(await zipFixture({ "readme.txt": "not Word" }))),
    ).rejects.toThrow(/Word document/i);
  });
  it.each(["word/vbaProject.bin", "word/embeddings/object.bin", "word/activeX/control.xml"])(
    "refuses active package part %s",
    async (name) => {
      await expect(
        validateDocx(bytes(await docxFixture({ extra: { [name]: "active" } }))),
      ).rejects.toThrow(/active content/i);
    },
  );
  it.each(["<!DOCTYPE x [<!ENTITY x 'expanded'>]><x>&x;</x>", "<w:document>"])(
    "rejects unsafe or malformed XML",
    async (xml) => {
      await expect(
        validateDocx(bytes(await docxFixture({ extra: { "word/document.xml": xml } }))),
      ).rejects.toThrow(/XML/i);
    },
  );
  it("refuses a declared decompression bomb before inflation", async () => {
    const data = await docxFixture();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < data.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 0x7fffffff, true);
        break;
      }
    }
    await expect(validateDocx(bytes(data))).rejects.toThrow(/too large/i);
  });
  it("rejects a false uncompressed size, not only the declared limit", async () => {
    const data = await docxFixture({ compression: "DEFLATE" });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < data.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1, true);
        break;
      }
    }
    await expect(validateDocx(bytes(data))).rejects.toThrow(/size/i);
  });
  it("rejects an entry whose local payload points into the central directory", async () => {
    const data = await docxFixture();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < data.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 42, i, true);
        break;
      }
    }
    await expect(validateDocx(bytes(data))).rejects.toThrow(/archive/i);
  });
  it("rejects unsupported compression and encrypted entries", async () => {
    for (const [offset, value] of [
      [10, 99],
      [8, 1],
    ]) {
      const data = await docxFixture();
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let i = 0; i < data.length - 46; i++) {
        if (view.getUint32(i, true) === 0x02014b50) {
          view.setUint16(i + offset, value, true);
          break;
        }
      }
      await expect(validateDocx(bytes(data))).rejects.toThrow(/unsupported|encrypted/i);
    }
  });
  it("rejects oversized and invalid data URLs before base64 decoding", () => {
    expect(() => decodeDocxSource("https://example.invalid/a.docx")).toThrow(/data/i);
    expect(() => decodeDocxSource("data:application/zip;base64,???")).toThrow();
    expect(() => decodeDocxSource(`data:application/zip;base64,${"A".repeat(36_000_000)}`)).toThrow(
      /too large/i,
    );
  });
  it("accepts an empty Word body", async () => {
    await expect(
      validateDocx(bytes(await docxFixture({ extra: { "word/document.xml": WORD_XML("") } }))),
    ).resolves.toBeUndefined();
  });
});
