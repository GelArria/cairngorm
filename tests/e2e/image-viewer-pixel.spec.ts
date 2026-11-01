import { test, expect } from "./fixtures";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Image Viewer — Pixel Verification", () => {
  test("renders real PNG and pixel content is not all black", async ({ app: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });

    // Generate a real gradient PNG in-browser (no repo asset needed)
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext("2d")!;
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          ctx.fillStyle = `rgb(${Math.round((x / 31) * 255)},${Math.round((y / 31) * 255)},128)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      return c.toDataURL("image/png");
    });

    await page.evaluate((src) => {
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: "gradient-pixel-test.png",
            path: ["gradient-pixel-test.png"],
            content: "",
            extension: "png",
            imageSrc: src,
          },
        }),
      );
    }, dataUrl);

    await page.locator("[data-testid='image-viewer'] img").waitFor({ timeout: 15000 });
    const loaded = await page.evaluate(() => {
      const img = document.querySelector("[data-testid='image-viewer'] img") as HTMLImageElement;
      return { complete: img.complete, nW: img.naturalWidth, nH: img.naturalHeight };
    });
    expect(loaded.complete).toBe(true);

    // Pixel analysis: sample 9 areas, expect more than one unique color (not a flat/black image)
    const pixelAnalysis = await page.evaluate(() => {
      const img = document.querySelector("[data-testid='image-viewer'] img") as HTMLImageElement;
      if (!img) return null;

      const canvas = document.createElement("canvas");
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const samples = [];
      const points = [
        [1, 1],
        [Math.floor(w / 2), 1],
        [w - 1, 1],
        [1, Math.floor(h / 2)],
        [Math.floor(w / 2), Math.floor(h / 2)],
        [w - 1, Math.floor(h / 2)],
        [1, h - 1],
        [Math.floor(w / 2), h - 1],
        [w - 1, h - 1],
      ];
      for (const [x, y] of points) {
        const px = ctx.getImageData(x, y, 1, 1).data;
        samples.push({ x, y, r: px[0], g: px[1], b: px[2], a: px[3] });
      }

      const uniqueColors = new Set(samples.map((s) => `${s.r},${s.g},${s.b}`));
      return { samples, uniqueColorCount: uniqueColors.size, width: w, height: h };
    });

    expect(pixelAnalysis).not.toBeNull();
    expect(pixelAnalysis!.width).toBe(32);
    expect(pixelAnalysis!.height).toBe(32);
    expect(pixelAnalysis!.uniqueColorCount).toBeGreaterThan(1);

    const img = page.locator("[data-testid='image-viewer'] img");
    const screenshot = await img.screenshot();
    fs.writeFileSync(path.resolve(__dirname, "../../logs/e2e/pixel-test-img-only.png"), screenshot);
  });
});
