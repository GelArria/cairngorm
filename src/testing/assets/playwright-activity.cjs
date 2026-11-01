const { randomUUID } = require("node:crypto");

// Observe public page/locator actions. Never include entered text or uploaded file contents.
function observeActions(page, pageId, deliver, metadata) {
  const observed = new WeakSet();
  const queue = new Map();
  let pending = Promise.resolve(),
    sending = false,
    retryAt = 0;
  const sendPending = () => {
    if (sending) {
      return;
    }
    sending = true;
    pending = (async () => {
      while (queue.size) {
        const [id, next] = queue.entries().next().value;
        queue.delete(id);
        try {
          if ((await deliver(next)) === false) {
            retryAt = Date.now() + 5000;
            queue.clear();
          }
        } catch {
          retryAt = Date.now() + 5000;
          queue.clear();
        }
      }
    })().finally(() => {
      sending = false;
      if (queue.size) {
        sendPending();
      }
    });
  };
  const emit = (event) => {
    if (Date.now() < retryAt) {
      return;
    }
    queue.set(event.activityId, event);
    if (queue.size > 200) {
      queue.delete(queue.keys().next().value);
    }
    sendPending();
  };
  const targetName = (target) => {
    const name =
      target.match(/name:\s*['"]([^'"]+)['"]/)?.[1] ||
      target.match(/getBy(?:Text|Label|Placeholder|TestId)\(['"]([^'"]+)['"]/)?.[1];
    return (name || target.replace(/^locator\(['"]|['"]\)$/g, "")).slice(0, 160);
  };
  const methods = {
    click: "Click",
    dblclick: "Double click",
    fill: "Fill",
    press: "Press key",
    check: "Check",
    uncheck: "Uncheck",
    selectOption: "Select option",
    hover: "Hover",
    tap: "Tap",
    type: "Type",
    pressSequentially: "Type",
    setInputFiles: "Upload file",
    waitFor: "Wait for",
    focus: "Focus",
    clear: "Clear",
    dragTo: "Drag",
  };
  function action(target, name, label) {
    if (typeof target[name] !== "function") {
      return;
    }
    const original = target[name];
    target[name] = async function (...args) {
      const startedAt = Date.now(),
        activityId = randomUUID();
      const base = {
        type: "activity",
        pageId,
        activityId,
        startedAt,
        label: label(args).slice(0, 512),
        ...metadata(),
      };
      emit({ ...base, timestamp: startedAt, status: "running" });
      try {
        const value = await original.apply(this, args);
        emit({ ...base, timestamp: Date.now(), status: "completed" });
        return value;
      } catch (error) {
        emit({ ...base, timestamp: Date.now(), status: "failed" });
        throw error;
      }
    };
  }
  function locators(target) {
    if (observed.has(target)) {
      return target;
    }
    observed.add(target);
    for (const method of [
      "locator",
      "getByRole",
      "getByText",
      "getByLabel",
      "getByTestId",
      "getByPlaceholder",
      "getByAltText",
      "getByTitle",
      "filter",
      "nth",
      "first",
      "last",
      "and",
      "or",
      "frameLocator",
      "contentFrame",
    ]) {
      if (typeof target[method] !== "function") {
        continue;
      }
      const original = target[method];
      target[method] = function (...args) {
        const value = original.apply(this, args);
        return value ? locators(value) : value;
      };
    }
    if (target !== page) {
      for (const [method, verb] of Object.entries(methods)) {
        action(target, method, () => `${verb} · ${targetName(String(target))}`);
      }
    }
    return target;
  }
  locators(page);
  for (const [method, verb] of Object.entries(methods)) {
    action(page, method, (args) => `${verb} · ${targetName(String(args[0] || "page"))}`);
  }
  action(page, "goto", (args) => {
    try {
      const url = new URL(args[0], "http://relative");
      return `Navigate · ${url.host === "relative" ? "" : url.host}${url.pathname}`;
    } catch {
      return "Navigate to page";
    }
  });
  action(page, "reload", () => "Reload page");
  action(page, "goBack", () => "Go back");
  action(page, "goForward", () => "Go forward");
  action(page, "waitForTimeout", (args) => `Wait · ${args[0]} ms`);
  return async () => {
    do {
      await pending;
    } while (sending || queue.size);
  };
}
module.exports = { observeActions };
