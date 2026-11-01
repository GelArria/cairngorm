import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const succeeds of [true, false]) {
  test(`scheduled CLI waits for the actual ${succeeds ? "answer" : "provider failure"} and exits`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairngorm-scheduled-"));
    const project = join(dir, "project");
    mkdirSync(project);
    let promptReceived = false;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        promptReceived = (await request.text()).includes("Review this project");
        if (!succeeds) {
          return Response.json(
            { error: { message: "Scheduled provider denied" } },
            { status: 401 },
          );
        }
        await Bun.sleep(50);
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Review finished" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          provider: "openai",
          model: "test",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
        }),
      );
      const child = Bun.spawn(
        [process.execPath, resolve(import.meta.dir, "../cli.ts"), "--sidecar", "--scheduled"],
        {
          cwd: project,
          env: {
            ...process.env,
            PANEL_AGENT_DIR: dir,
            CAIRNGORM_AGENT_API_KEY: "test-native-secret",
          },
          stdin: new Blob(['{"type":"prompt","content":"Review this project"}\n']),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [output, errors, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit).toBe(succeeds ? 0 : 1);
      expect(promptReceived).toBe(true);
      expect(JSON.parse(output).success).toBe(succeeds);
      if (succeeds) {
        expect(JSON.parse(output).output).toBe("Review finished");
      }
      expect(output + errors).not.toContain("test-native-secret");
      expect(output).not.toContain("sidecar_ready");
    } finally {
      await server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
}
