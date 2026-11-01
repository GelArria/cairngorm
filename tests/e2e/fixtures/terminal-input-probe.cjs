// Real ConPTY input recorder. No mocks, networking, credentials or shell commands.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("\r\nPROBE-READY\r\nSELECT alpha beta gamma\r\n");
process.stdin.on("data", function onData(bytes) {
  process.stdout.write(`\r\nKEY:${bytes.toString("hex")}\r\n`);
  if (bytes.toString("hex") === "1b5b32337e") {
    process.stdin.removeListener("data", onData);
    void import("./pi-mouse-probe.mjs");
    return;
  }
  if (bytes.toString("hex") === "1b5b32347e") {
    process.stdout.write("\x1b[?1000h\x1b[?1006h\r\nMOUSE-ON\r\n");
  }
});
