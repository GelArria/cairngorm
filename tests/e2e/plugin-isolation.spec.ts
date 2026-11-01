import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type FrameLocator } from "@playwright/test";

const config: { app: { security: { csp: string } } } = JSON.parse(
  fs.readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

const fixture: { origins: string[]; policy: string } | null = process.env.CAIRNGORM_PLUGIN_ISOLATION
  ? JSON.parse(process.env.CAIRNGORM_PLUGIN_ISOLATION)
  : null;

const canvas = `<!doctype html><html lang="en"><title>Plugin canvas</title>
<body><h2>Plugin canvas</h2><label>Diagram <input aria-label="Diagram"></label>
<button>Save</button><p>IndexedDB: <output></output></p><script>
const input = document.querySelector('input');
const output = document.querySelector('output');
input.value = localStorage.getItem('canvas') || '';
const request = indexedDB.open('canvas', 1);
request.onupgradeneeded = () => request.result.createObjectStore('state');
request.onsuccess = () => {
  const db = request.result;
  const restore = db.transaction('state').objectStore('state').get('document');
  restore.onsuccess = () => {
    output.textContent = restore.result || '';
    document.body.dataset.ready = 'true';
  };
  document.querySelector('button').onclick = () => {
    localStorage.setItem('canvas', input.value);
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(input.value, 'document');
    tx.oncomplete = () => { output.textContent = input.value; };
  };
};
</script></body></html>`;

test("native plugin origins preserve each project canvas across switches", async ({ page }) => {
  test.skip(!fixture, "Run through the native browser storage isolation test");
  if (!fixture) {
    return;
  }
  const { origins, policy } = fixture;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/host") {
      response.setHeader("Content-Security-Policy", config.app.security.csp);
      response.end(
        "<!doctype html><html lang='en'><title>Plugin isolation</title><body><h1>Separate project canvases</h1></body></html>",
      );
    } else {
      response.setHeader("Content-Security-Policy", policy);
      response.end(canvas);
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Plugin fixture did not bind a loopback port");
    }
    const { port } = address;
    const urls = origins.map((origin) => {
      const url = new URL("/view/call", origin);
      url.port = String(port);
      return url.href;
    });
    await page.setViewportSize({ width: 1200, height: 780 });
    await page.goto(`http://127.0.0.1:${port}/host`);
    const open = async (url: string, name = "canvas") => {
      await page.evaluate(
        ({ url, name }) => {
          document.querySelector(`iframe[name="${name}"]`)?.remove();
          const frame = document.createElement("iframe");
          frame.name = name;
          frame.title = name;
          frame.width = "540";
          frame.height = "300";
          frame.sandbox =
            "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads";
          frame.src = url;
          document.body.append(frame);
        },
        { url, name },
      );
      const frame = page.frameLocator(`iframe[name="${name}"]`);
      await frame.locator('body[data-ready="true"]').waitFor();
      return frame;
    };
    const save = async (frame: FrameLocator, value: string) => {
      await frame.getByRole("textbox", { name: "Diagram" }).fill(value);
      await frame.getByRole("button", { name: "Save" }).click();
      await expect(frame.locator("output")).toHaveText(value);
    };
    const check = async (frame: FrameLocator, value: string) => {
      await expect(frame.getByRole("textbox", { name: "Diagram" })).toHaveValue(value);
      await expect(frame.locator("output")).toHaveText(value);
    };
    await save(await open(urls[0]), "Project A: original diagram");
    const b = await open(urls[1]);
    await check(b, "");
    await save(b, "Project B: unrelated diagram");
    await check(await open(urls[0]), "Project A: original diagram");
    await check(await open(urls[1]), "Project B: unrelated diagram");
    const otherPlugin = await open(urls[2]);
    await check(otherPlugin, "");
    await save(otherPlugin, "Project A: different plugin");
    await check(await open(urls[0], "project-a"), "Project A: original diagram");
    await check(await open(urls[1], "project-b"), "Project B: unrelated diagram");
    const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../logs/e2e");
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, "plugin-isolation.png") });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
