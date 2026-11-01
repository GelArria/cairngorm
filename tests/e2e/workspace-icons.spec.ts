import { test, expect } from "./fixtures";

async function mockTree(app: import("@playwright/test").Page) {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const internal = (window as any).__TAURI_INTERNALS__;
    const previous = internal.invoke;
    internal.invoke = (command: string, args: any) => {
      if (command === "fs_list_dir") {
        const names = args.path.endsWith("src")
          ? ["index.ts", "app.js", "styles.css"]
          : [
              "src",
              "package.json",
              "README.md",
              "logo.svg",
              "archive.zip",
              "notes.txt",
              "unknown.xyz",
            ];
        return Promise.resolve(
          names.map((name) => ({
            name,
            path: args.path + "/" + name,
            isDirectory: name === "src",
            size: name === "src" ? null : 120,
          })),
        );
      }
      if (command === "fs_read_file")
        return Promise.resolve('export const greeting = "Cairngorm";');
      return previous(command, args);
    };
  });
  await app.reload();
}

test("file type colors survive selection and theme changes, and respect icon adjustments", async ({
  app,
}) => {
  await mockTree(app);
  await app.getByTestId("sidebar-files-toggle").click();
  const row = (name: string) =>
    app.getByTestId("file-tree-row").filter({ has: app.getByText(name, { exact: true }) });
  const icon = (name: string) => row(name).locator("svg").last();
  await row("src").click();
  await expect(row("index.ts")).toBeVisible();
  const darkBlue = await icon("index.ts").evaluate((el) => getComputedStyle(el).color);
  const yellow = await icon("app.js").evaluate((el) => getComputedStyle(el).color);
  expect(darkBlue).not.toBe(yellow);
  await row("index.ts").click();
  await expect(app.locator(".cm-editor")).toContainText("Cairngorm");
  await expect(icon("index.ts")).toHaveCSS("color", darkBlue);
  await app.takeScreenshot("workspace-icons-dark");

  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  await app.getByTestId("theme-white").click();
  await app.keyboard.press("Escape");
  await expect(app.locator("html")).not.toHaveClass(/dark/);
  const lightBlue = await icon("index.ts").evaluate((el) => getComputedStyle(el).color);
  expect(lightBlue).not.toBe(darkBlue);
  await expect(app.locator(".cm-editor")).toContainText("Cairngorm");
  await app.takeScreenshot("workspace-icons-light");
  await row("src").click();
  await expect(row("index.ts")).toHaveCount(0);
  await row("src").click();
  await expect(icon("index.ts")).toHaveCSS("color", lightBlue);

  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  await app.getByLabel("Icons & ticks color", { exact: true }).fill("#805020");
  const brightness = app.getByRole("slider", { name: "Icon & tick brightness", exact: true });
  await brightness.focus();
  await brightness.press("ArrowRight");
  for (const name of ["src", "index.ts", "app.js", "package.json", "unknown.xyz"]) {
    await expect(icon(name)).toHaveCSS("color", "rgb(128, 80, 32)");
    await expect(icon(name)).toHaveCSS("filter", "brightness(1.01)");
  }
  await app.getByRole("button", { name: "Reset adjustments", exact: true }).click();
  await expect(icon("index.ts")).toHaveCSS("color", lightBlue);
  await expect(icon("index.ts")).toHaveCSS("filter", "brightness(1)");
});

test("explorer icon styles: choose one in Settings and the tree follows", async ({ app }) => {
  await mockTree(app);
  await app.getByTestId("sidebar-files-toggle").click();
  const row = (name: string) =>
    app.getByTestId("file-tree-row").filter({ has: app.getByText(name, { exact: true }) });
  await expect(row("package.json")).toBeVisible();

  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  const picker = app.getByTestId("file-icon-settings");
  await expect(picker.getByRole("radio")).toHaveCount(5);
  await expect(picker.getByRole("radio", { name: /Outline/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // One Tab stop; arrows move the selection like native radios.
  const outline = picker.getByRole("radio", { name: /Outline/ });
  await expect(picker.getByRole("radio", { name: /Material/ })).toHaveAttribute("tabindex", "-1");
  await outline.focus();
  await app.keyboard.press("ArrowDown");
  await expect(picker.getByRole("radio", { name: /Material/ })).toBeFocused();
  await expect(picker.getByRole("radio", { name: /Material/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await picker.screenshot({ path: "logs/e2e/file-icon-settings.png", animations: "disabled" });
  await app.keyboard.press("Escape");

  // Material: the bundled full-colour SVGs, loaded.
  const material = row("package.json").locator("img");
  await expect(material).toHaveAttribute("src", "/file-icons/material/npm.svg");
  await expect
    .poll(() => material.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(row("src").locator("img")).toHaveAttribute(
    "src",
    "/file-icons/material/folder-src.svg",
  );
  await app.getByTestId("sidebar").screenshot({ path: "logs/e2e/file-icons-material.png" });

  // Badges; the choice survives a reload.
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  await picker.getByRole("radio", { name: /Badges/ }).click();
  await app.keyboard.press("Escape");
  await row("src").click();
  await expect(row("index.ts")).toContainText("TS");
  await app.getByTestId("sidebar").screenshot({ path: "logs/e2e/file-icons-badges.png" });
  await app.reload();
  await app.getByTestId("sidebar-files-toggle").click();
  await expect(row("README.md")).toContainText("MD");
});
