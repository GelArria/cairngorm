// Regenerates the app icon (src-tauri/icons/icon.ico) and the favicon
// (public/favicon.svg) from the real gem renderer — the logo IS the loader gem
// frozen in its rest pose. Run: node scripts/gen-brand-icons.mjs
// No tile: the gem alone on transparency (taskbar, desktop). ≤ 60 px uses
// GEM_MINI — the full mesh blurs into a blob when downsized. A thin dark halo
// under the edges keeps the light stroke readable on light taskbars/wallpapers.
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 54, 60, 64, 96, 128, 256]; // 24…60 = taskbar at 100–250 % (window_icon.rs)
const ICO_MINI_MAX = 60; // taskbar sizes stay minimal up to 250 % scale

const bundle = await build({
  entryPoints: [`${root}src/common/branding//gem-draw.ts`],
  bundle: true,
  format: "iife",
  globalName: "Gem",
  write: false,
});

/** Edge width in output px: crisp on the mini, the splash's 1.2px/168px ratio above. */
const strokeFor = (size) =>
  size <= 16
    ? 1
    : size <= 24
      ? 1.25
      : size <= 36
        ? 1.5
        : size <= ICO_MINI_MAX
          ? 2
          : Math.min(2, Math.max(1.2, (1.2 * size) / 168));

// Runs in the page: draws the gem into #g, drops hidden parts, adds the halo
// and fits a square viewBox to the visible gem (pad px kept clear at the edge).
function drawIcon({ size, mini, stroke, padPx, inline }) {
  const { buildGem, GEM, GEM_MINI, GEM_REST } = window.Gem,
    el = document.getElementById("g");
  buildGem(el, 0, mini ? GEM_MINI : GEM)(GEM_REST.t, GEM_REST.yaw);
  el.querySelectorAll("[opacity='0']").forEach((n) => n.remove());
  if (mini) el.querySelectorAll("circle").forEach((n) => n.remove());
  const lines = [...el.querySelectorAll("line")];
  const xs = lines.flatMap((l) => [+l.getAttribute("x1"), +l.getAttribute("x2")]);
  const ys = lines.flatMap((l) => [+l.getAttribute("y1"), +l.getAttribute("y2")]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  const side = Math.max(x1 - x0, y1 - y0) * (size / (size - 2 * padPx));
  const vb = [(x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2, side, side].map((v) =>
    v.toFixed(2),
  );
  el.setAttribute("viewBox", vb.join(" "));
  const halo = stroke + (mini ? 1.5 : 1),
    haloOpacity = mini ? (size <= 20 ? 0.65 : 0.45) : 0.4;
  const style = (l, color, w) => {
    if (inline) {
      l.setAttribute("stroke", color);
      l.setAttribute("stroke-width", (w * side) / size);
      l.setAttribute("stroke-linecap", "round");
    } else
      Object.assign(l.style, {
        stroke: color,
        strokeWidth: `${w}px`,
        strokeLinecap: "round",
        vectorEffect: "non-scaling-stroke",
      });
  };
  lines.forEach((l) => {
    const h = l.cloneNode();
    style(h, "#0a0a0f", halo);
    h.setAttribute("opacity", haloOpacity);
    el.insertBefore(h, el.firstChild);
    style(l, "#d9c4a8", stroke);
  });
  el.querySelectorAll("circle").forEach((c) => {
    c.setAttribute("fill", "#ecdcc4");
    c.setAttribute("r", ((1.5 * side) / 132).toFixed(2));
  });
  el.removeAttribute("id");
  return el.outerHTML;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = [];
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style><svg id="g" width="${size}" height="${size}"></svg>`,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const mini = size <= ICO_MINI_MAX,
    stroke = strokeFor(size);
  // keep the halo (stroke + 1.5/1 px, round caps) fully inside the canvas
  const padPx = Math.max(mini ? 0 : size / 32, (stroke + (mini ? 1.5 : 1)) / 2 + 1);
  await page.evaluate(drawIcon, { size, mini, stroke, padPx, inline: false });
  pngs.push(await page.locator("svg").screenshot({ omitBackground: true }));
}

// Favicon (browser tabs, 16–32 px): the minimal gem as a static SVG, attributes inlined.
await page.setContent(
  `<svg id="g" xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>`,
);
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const svg = (
  await page.evaluate(drawIcon, { size: 32, mini: true, stroke: 1.5, padPx: 2, inline: true })
).replace(/ width="32" height="32"/, "");
// NSIS uses opaque BMPs: the same gem on a dark welcome panel and white header.
mkdirSync(`${root}logs/e2e`, { recursive: true });
for (const [name, width, height, size, dark] of [
  ["sidebar", 164, 314, 136, true],
  ["header", 150, 57, 46, false],
]) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    body{background:${dark ? "#0a0a0f" : "#ffffff"};color:${dark ? "#ecdcc4" : "#302a24"};font-family:Segoe UI,sans-serif;
      display:flex;align-items:center;justify-content:center;${dark ? "flex-direction:column;gap:18px" : "gap:6px"}}
    svg{display:block;flex-shrink:0}span{font-size:${dark ? 18 : 13}px;font-weight:600}
    </style><svg id="g" width="${size}" height="${size}"></svg><span>Cairngorm</span>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const mark = await page.evaluate(drawIcon, {
    size,
    mini: !dark,
    stroke: 1.3,
    padPx: 6,
    inline: true,
  });
  await page.evaluate(
    ({ mark, dark }) => {
      document.querySelector("svg").outerHTML = dark
        ? mark
        : mark.replaceAll("#d9c4a8", "#6f5940").replaceAll("#ecdcc4", "#6f5940");
    },
    { mark, dark },
  );
  const png = `${root}logs/e2e/installer-${name}.png`;
  const bmp = `${root}src-tauri/icons/installer-${name}.bmp`;
  await page.screenshot({ path: png });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `
    Add-Type -AssemblyName System.Drawing;
    $src = [System.Drawing.Image]::FromFile('${png.replaceAll("'", "''")}');
    $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb);
    $g = [System.Drawing.Graphics]::FromImage($bmp);
    try { $g.DrawImage($src, 0, 0, $src.Width, $src.Height); $bmp.Save('${bmp.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Bmp) }
    finally { $g.Dispose(); $bmp.Dispose(); $src.Dispose() }
  `,
  ]);
}
await browser.close();
writeFileSync(`${root}public/favicon.svg`, svg + "\n");

// ICO container with PNG-compressed entries (Vista+), largest last.
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + i * 16,
    s = SIZES[i] >= 256 ? 0 : SIZES[i];
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync(`${root}src-tauri/icons/icon.ico`, Buffer.concat([header, ...pngs]));
console.log(`icon.ico: ${SIZES.join(", ")} px · favicon.svg: ${svg.length} bytes`);
