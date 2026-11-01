const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { observeActions } = require("./playwright-activity.cjs");
const observed = new WeakSet();
const captures = new WeakMap();
let testInfo;

function deliver(event, jpeg) {
  return new Promise((resolve) => {
    const binary = jpeg && process.env.CAIRNGORM_TEST_BINARY === "1";
    const metadata = Buffer.from(
      JSON.stringify(binary ? event : jpeg ? { ...event, image: jpeg.toString("base64") } : event),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(metadata.length);
    const body = binary ? Buffer.concat([prefix, metadata, jpeg]) : metadata;
    let request;
    try {
      request = http.request(
        process.env.CAIRNGORM_TEST_ENDPOINT,
        {
          method: "POST",
          headers: {
            "Content-Type": binary ? "application/octet-stream" : "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${process.env.CAIRNGORM_TEST_TOKEN}`,
          },
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            resolve(response.statusCode >= 200 && response.statusCode < 300),
          );
        },
      );
      request.on("error", () => resolve(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
      request.end(body);
    } catch {
      request?.destroy();
      resolve(false);
    }
  });
}

function metadata() {
  try {
    const info = testInfo?.();
    return { testName: info?.titlePath?.join(" › "), projectName: info?.project?.name };
  } catch {
    return {};
  }
}

function observePage(page, browserName) {
  if (observed.has(page)) {
    return;
  }
  observed.add(page);
  const pageId = randomUUID();
  const detailsForPage = () => ({ ...metadata(), browserName });
  const flushActions = observeActions(page, pageId, deliver, detailsForPage);
  let busy,
    ended = false;
  const capture = () => {
    if (busy || ended || page.isClosed()) {
      return busy ?? Promise.resolve();
    }
    const details = detailsForPage();
    busy = (async () => {
      try {
        const image = await page.screenshot({
          type: "jpeg",
          quality: 65,
          timeout: 800,
          scale: "css",
          caret: "initial",
        });
        if (ended) {
          return;
        }
        const size = page.viewportSize();
        await deliver(
          {
            type: "frame",
            pageId,
            timestamp: Date.now(),
            url: page.url(),
            title: await page.title().catch(() => ""),
            width: size?.width ?? 1280,
            height: size?.height ?? 720,
            ...details,
          },
          image,
        );
      } catch {
        /* Navigation, page closure and unavailable capture are expected. */
      }
    })().finally(() => {
      busy = undefined;
    });
    return busy;
  };
  const timer = setInterval(capture, 300);
  timer.unref();
  page.on("domcontentloaded", capture);
  page.once("close", () => {
    ended = true;
    clearInterval(timer);
    Promise.all([busy, flushActions()]).finally(() =>
      deliver({ type: "closed", pageId, timestamp: Date.now() }),
    );
  });
  // Preserve the final screen even when the test tears down immediately after its last action.
  const finalCapture = async () => {
    await busy;
    await capture();
    await flushActions();
  };
  wrap(page, "close", async (original) => {
    await finalCapture();
    return original();
  });
  captures.set(page, finalCapture);
  void capture();
}

function wrap(target, name, handler) {
  if (typeof target[name] !== "function") {
    return;
  }
  const original = target[name];
  target[name] = function (...args) {
    return handler(() => original.apply(this, args));
  };
}

function observeContext(context, browserName) {
  if (observed.has(context)) {
    return context;
  }
  observed.add(context);
  context.on("page", (page) => observePage(page, browserName));
  context.pages().forEach((page) => observePage(page, browserName));
  wrap(context, "close", async (original) => {
    await Promise.all(context.pages().map((page) => captures.get(page)?.()));
    return original();
  });
  return context;
}

function observeBrowser(browser, browserName) {
  if (observed.has(browser)) {
    return browser;
  }
  observed.add(browser);
  for (const method of ["newContext", "_newContextForReuse"]) {
    wrap(browser, method, async (original) => observeContext(await original(), browserName));
  }
  browser.contexts().forEach((context) => observeContext(context, browserName));
  wrap(browser, "close", async (original) => {
    await Promise.all(
      browser
        .contexts()
        .flatMap((context) => context.pages().map((page) => captures.get(page)?.())),
    );
    return original();
  });
  return browser;
}

function attachPlaywright(api) {
  if (api.test?.info) {
    testInfo = () => api.test.info();
  }
  for (const name of ["chromium", "firefox", "webkit"]) {
    const browserType = api[name];
    if (!browserType || observed.has(browserType)) {
      continue;
    }
    observed.add(browserType);
    for (const method of ["launch", "connect", "connectOverCDP"]) {
      wrap(browserType, method, async (original) => observeBrowser(await original(), name));
    }
    wrap(browserType, "launchPersistentContext", async (original) =>
      observeContext(await original(), name),
    );
  }
}
module.exports = { attachPlaywright };
