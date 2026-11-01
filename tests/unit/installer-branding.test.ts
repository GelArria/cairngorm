import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const windowsConfig = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.windows.conf.json"), "utf8"),
);

test("NSIS uses Cairngorm's opaque 24-bit artwork at its recommended sizes", () => {
  const nsis = windowsConfig.bundle.windows.nsis;
  expect(config.productName).toBe("Cairngorm");
  for (const [key, width, height] of [
    ["sidebarImage", 164, 314],
    ["headerImage", 150, 57],
  ] as const) {
    const image = readFileSync(resolve(root, "src-tauri", nsis[key]));
    expect(image.subarray(0, 2).toString()).toBe("BM");
    expect(image.readInt32LE(18)).toBe(width);
    expect(Math.abs(image.readInt32LE(22))).toBe(height);
    expect(image.readUInt16LE(28)).toBe(24);
  }
  expect(nsis.installerIcon).toBe("icons/icon.ico");
  expect(nsis.uninstallerIcon).toBe("icons/icon.ico");
  const icon = readFileSync(resolve(root, "src-tauri", nsis.installerIcon));
  expect(icon.readUInt16LE(2)).toBe(1);
});
