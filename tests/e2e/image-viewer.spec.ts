import { test, expect, openFileInGrid } from "./fixtures";

const TEST_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJ0lEQVQYV2NkwAIY4TOq6PrzE0s2UjCCg5OBwqdU6FyldxIMABGrA0eilg51AAAAAElFTkSuQmCC";

test.describe("Image Viewer", () => {
  test("renders image from data URL without broken icon", async ({ app }) => {
    await openFileInGrid(app, {
      title: "test-image.png",
      path: ["test-image.png"],
      content: "",
      extension: "png",
      imageSrc: TEST_IMAGE_DATA_URL,
    });

    const editorView = app.locator("[data-testid='image-viewer']");
    await expect(editorView.locator(".truncate").first()).toContainText("test-image.png");

    const imgState = await app.evaluate(() => {
      const img = document.querySelector(
        "[data-testid='image-viewer'] img",
      ) as HTMLImageElement | null;
      if (!img) return { found: false, loaded: false };
      return { found: true, loaded: img.complete && img.naturalWidth > 0 };
    });
    expect(imgState.found).toBe(true);
    expect(imgState.loaded).toBe(true);

    const shot = await app.takeScreenshot("image-viewer-data-url");
    console.log(`Screenshot: ${shot}`);
  });

  test("image viewer shows zoom controls and filename", async ({ app }) => {
    await openFileInGrid(app, {
      title: "screenshot.png",
      path: ["screenshot.png"],
      content: "",
      extension: "png",
      imageSrc: TEST_IMAGE_DATA_URL,
    });

    const editorView = app.locator("[data-testid='image-viewer']");
    await expect(editorView).toContainText("100%", { timeout: 5000 });
    await expect(editorView).toContainText("screenshot.png");

    const shot = await app.takeScreenshot("image-viewer-controls");
    console.log(`Screenshot: ${shot}`);
  });
});
