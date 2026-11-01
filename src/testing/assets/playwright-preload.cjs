// Inherited by Node subprocesses in Cairngorm terminals. Does not load Playwright itself.
const Module = require("node:module");
const { attachPlaywright } = require("./playwright-stream.cjs");
if (process.env.CAIRNGORM_TEST_ENDPOINT && process.env.CAIRNGORM_TEST_TOKEN) {
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    const value = load.apply(this, arguments);
    const path = request.replace(/\\/g, "/");
    if (
      /^(?:@playwright\/test|playwright(?:-core)?(?:\/test)?)$/.test(path) ||
      /\/(?:@playwright\/test|playwright(?:-core)?)\/(?:index|test)\.c?js$/.test(path)
    ) {
      try {
        attachPlaywright(value);
      } catch {
        /* Observation must never break a test. */
      }
    }
    return value;
  };
}
