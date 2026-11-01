import { test, expect } from "./fixtures";

// Drive the real TerminalTab output path through the PTY replay boundary.
// No real shell is started; the bytes and xterm renderer are real.
for (const protocol of ["sixel", "iterm2"] as const) {
  test(`terminal renders ${protocol} pixels instead of an empty imgcat area`, async ({ app }) => {
    await app.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(() => localStorage.setItem("show-splash", "false"));
    await app.reload();
    await app.evaluate(async (mode) => {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 30;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 40, 30);
      const png = canvas.toDataURL("image/png").split(",")[1];
      const sixel = '\x1bP0;1;0q"1;1;40;30#1;2;100;0;0#1!40~-!40~-!40~-!40~-!40~\x1b\\';
      const iterm = `\x1b]1337;File=inline=1;size=${atob(png).length};width=40px;height=30px;preserveAspectRatio=1:${png}\x07`;
      const bytes = `imgcat ${mode} preview\r\n${mode === "sixel" ? sixel : iterm}\r\nimage complete\r\n`;
      const internals = (window as any).__TAURI_INTERNALS__;
      const previous = internals.invoke;
      internals.invoke = (cmd: string, args: any) => {
        if (cmd === "pty_replay") return Promise.resolve(btoa(bytes));
        if (cmd.startsWith("pty_")) return Promise.resolve(null);
        if (cmd === "detect_home") return Promise.resolve("C:/repo");
        return previous(cmd, args);
      };
    }, protocol);
    await app.locator('button[aria-label="New terminal"]').click();
    await app.getByRole("menuitem", { name: "Default shell", exact: true }).click();
    const probe = app.locator(".xterm").last();
    await expect(probe.locator(".xterm-rows")).toContainText("image complete");
    await expect
      .poll(() =>
        probe.evaluate((el) =>
          [...el.querySelectorAll<HTMLCanvasElement>("canvas.xterm-image-layer")].some((canvas) => {
            const ctx = canvas.getContext("2d");
            if (!ctx || !canvas.width || !canvas.height) return false;
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let red = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (
                pixels[i] > 240 &&
                pixels[i + 1] < 15 &&
                pixels[i + 2] < 15 &&
                pixels[i + 3] > 200
              )
                red++;
            return red >= 1000;
          }),
        ),
      )
      .toBe(true);
    await app.screenshot({ path: `logs/e2e/terminal-image-${protocol}.png` });
  });
}
