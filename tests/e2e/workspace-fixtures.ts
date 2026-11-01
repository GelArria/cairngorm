import { test as base, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../logs/e2e");

const MOCK_HOME = "C:\\Users\\TestUser";

const MOCK_INVOKE = `
(function() {
  const HOME = ${JSON.stringify(MOCK_HOME)};
  const DIRS = {
    [HOME]: [
      { name: "Documents", path: HOME + "\\\\Documents", isDirectory: true, size: null },
      { name: "Desktop", path: HOME + "\\\\Desktop", isDirectory: true, size: null },
      { name: "Downloads", path: HOME + "\\\\Downloads", isDirectory: true, size: null },
      { name: "Projects", path: HOME + "\\\\Projects", isDirectory: true, size: null },
      { name: "readme.md", path: HOME + "\\\\readme.md", isDirectory: false, size: 245 },
      { name: "config.json", path: HOME + "\\\\config.json", isDirectory: false, size: 120 },
      { name: ".gitconfig", path: HOME + "\\\\gitconfig_hidden", isDirectory: false, size: 10 },
    ],
    [HOME + "\\\\Documents"]: [
      { name: "Work", path: HOME + "\\\\Documents\\\\Work", isDirectory: true, size: null },
      { name: "notes.txt", path: HOME + "\\\\Documents\\\\notes.txt", isDirectory: false, size: 50 },
      { name: "report.md", path: HOME + "\\\\Documents\\\\report.md", isDirectory: false, size: 300 },
    ],
    [HOME + "\\\\Documents\\\\Work"]: [
      { name: "todo.md", path: HOME + "\\\\Documents\\\\Work\\\\todo.md", isDirectory: false, size: 80 },
    ],
    [HOME + "\\\\Projects"]: [
      { name: "my-app", path: HOME + "\\\\Projects\\\\my-app", isDirectory: true, size: null },
    ],
    [HOME + "\\\\Desktop"]: [],
    [HOME + "\\\\Downloads"]: [
      { name: "installer.exe", path: HOME + "\\\\Downloads\\\\installer.exe", isDirectory: false, size: 50000000 },
    ],
    [HOME + "\\\\Projects\\\\my-app"]: [
      { name: "package.json", path: HOME + "\\\\Projects\\\\my-app\\\\package.json", isDirectory: false, size: 200 },
      { name: "src", path: HOME + "\\\\Projects\\\\my-app\\\\src", isDirectory: true, size: null },
      { name: "logo.png", path: HOME + "\\\\Projects\\\\my-app\\\\logo.png", isDirectory: false, size: 1234 },
    ],
  };
  const FILES = {
    [HOME + "\\\\readme.md"]: "# Hello World\\nThis is a test file.\\nSome more content.",
    [HOME + "\\\\config.json"]: "{\\n  \\"key\\": \\"value\\",\\n  \\"debug\\": true\\n}",
    [HOME + "\\\\Documents\\\\notes.txt"]: "Some notes here.\\nLine 2.\\nLine 3.",
    [HOME + "\\\\Documents\\\\report.md"]: "# Report\\n\\nThis is a report with **bold** text.",
    [HOME + "\\\\Documents\\\\Work\\\\todo.md"]: "- [ ] Task 1\\n- [x] Task 2\\n- [ ] Task 3",
    [HOME + "\\\\Projects\\\\my-app\\\\package.json"]: "{\\n  \\"name\\": \\"my-app\\"\\n}",
  };

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      const p = args?.path ?? "";
      switch (cmd) {
        case "fs_list_dir": {
          const entries = DIRS[p];
          if (!entries) return Promise.reject("Not a directory: " + p);
          return Promise.resolve(entries.filter(e => !e.name.startsWith(".")));
        }
        case "fs_read_file":
          if (FILES[p] !== undefined) return Promise.resolve(FILES[p]);
          return Promise.reject("File not found: " + p);
        case "fs_write_file":
          return Promise.resolve();
        case "fs_exists":
          return Promise.resolve(p in FILES || p in DIRS || p === HOME);
        case "fs_read_file_data_url": {
          if (p.endsWith(".png")) return Promise.resolve("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVQYV2P8z8BQz0BCpArQRGYDAVMTAdeJYQAAAABJRU5ErkJggg==");
          if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return Promise.resolve("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==");
          return Promise.reject("Not an image: " + p);
        }
        case "fs_search_files":
          return Promise.resolve([]);
        default:
          return Promise.reject("Unknown command: " + cmd);
      }
    }
  };
  window.__TAURI_HOME__ = HOME;
  localStorage.setItem("sidebar-side", "left");
  localStorage.setItem("show-splash", "false");
})();
`;

type Fixtures = { app: import("@playwright/test").Page };

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(MOCK_INVOKE);
    await page.goto("/");
    await page.waitForTimeout(2500);
    // Explorer now lives inside the left sidebar (default off) — open it via the Files toggle
    await page.getByTestId("active-project").getByTestId("sidebar-files-toggle").click();
    await page.waitForTimeout(1200);

    const screenshot = async (name: string) => {
      if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const file = path.join(SCREENSHOT_DIR, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    };
    (page as any).takeScreenshot = screenshot;
    await use(page);
  },
});

export { expect };
