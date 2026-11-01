import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

// Exercise the production sender against loopback HTTP with the exact same real JPEG.
const browser = await chromium.launch({ headless: true });
let jpeg;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(fs.readFileSync("tests/e2e/fixtures/visual-app.html", "utf8"));
  jpeg = await page.screenshot({ type: "jpeg", quality: 65, scale: "css" });
} finally {
  await browser.close();
}
const metadata = {
  type: "frame",
  pageId: "transport-qa",
  timestamp: 1,
  width: 1280,
  height: 720,
  url: "http://fixture/",
  title: "Shop",
};
const sizes = { legacy: [], binary: [] };
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  assert.equal(request.headers.authorization, "Bearer transport-test");
  assert.equal(Number(request.headers["content-length"]), body.length);
  let event, decoded;
  const binary = request.headers["content-type"] === "application/octet-stream";
  if (binary) {
    const length = body.readUInt32BE();
    event = JSON.parse(body.subarray(4, 4 + length));
    decoded = body.subarray(4 + length);
    assert.equal(event.image, undefined);
  } else {
    event = JSON.parse(body);
    decoded = Buffer.from(event.image, "base64");
  }
  assert.equal(event.pageId, metadata.pageId);
  assert.deepEqual(decoded, jpeg);
  sizes[binary ? "binary" : "legacy"].push(body.length);
  response.writeHead(204);
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const sourcePath = path.resolve("src/testing/assets/playwright-stream.cjs");
  const env = {
    CAIRNGORM_TEST_ENDPOINT: `http://127.0.0.1:${server.address().port}/frame`,
    CAIRNGORM_TEST_TOKEN: "transport-test",
  };
  const sandbox = {
    require: createRequire(sourcePath),
    module: { exports: {} },
    Buffer,
    process: { env },
    setInterval,
  };
  vm.runInNewContext(
    fs.readFileSync(sourcePath, "utf8") + "\nmodule.exports.deliver = deliver;",
    sandbox,
    { filename: sourcePath },
  );
  for (const binary of [false, true]) {
    env.CAIRNGORM_TEST_BINARY = binary ? "1" : "0";
    for (let n = 0; n < 50; n++)
      assert.equal(await sandbox.module.exports.deliver(metadata, jpeg), true);
  }
  assert.equal(sizes.legacy.length, 50);
  assert.equal(sizes.binary.length, 50);
  assert.ok(sizes.binary.every((size) => size < sizes.legacy[0]));
  const result = {
    jpegBytes: jpeg.length,
    legacyHttpBodyBytes: sizes.legacy[0],
    binaryHttpBodyBytes: sizes.binary[0],
    bodyReductionPercent: Number((100 * (1 - sizes.binary[0] / sizes.legacy[0])).toFixed(2)),
    verifiedRequests: 100,
    byteParity: true,
    cpuAndFpsMeasured: false,
  };
  fs.writeFileSync(
    "logs/optimization-phase2-transport-bench.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    "PASS: production sender HTTP byte parity and binary transport",
    JSON.stringify(result),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
