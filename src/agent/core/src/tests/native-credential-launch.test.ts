import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("sidecar uses the native credential while a malicious model cannot read outside the project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cairngorm-launch-"));
  const project = join(dir, "project");
  mkdirSync(project);
  const outside = join(dir, "private.txt");
  writeFileSync(outside, "PRIVATE_OUTSIDE_VALUE");
  let requests = 0;
  const bodies: string[] = [];
  let authorized = true;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      authorized &&= request.headers.get("authorization") === "Bearer native-only-credential";
      bodies.push(await request.text());
      const choice =
        requests++ === 0
          ? {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "outside",
                    type: "function",
                    function: { name: "file-read", arguments: JSON.stringify({ path: outside }) },
                  },
                ],
              },
              finish_reason: "tool_calls",
            }
          : { delta: { content: "Protected" }, finish_reason: "stop" };
      return new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
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
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PANEL_AGENT_DIR: dir,
      CAIRNGORM_AGENT_API_KEY: "native-only-credential",
    };
    delete env.OPENAI_API_KEY;
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "../cli.ts"), "--sidecar"],
      {
        cwd: project,
        env,
        stdin: new Blob(['{"type":"prompt","content":"Check the file"}\n']),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [output, errors, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(0);
    expect(errors).not.toContain("native-only-credential");
    expect(output).toContain("Protected");
    expect(output).not.toContain("PRIVATE_OUTSIDE_VALUE");
    expect(output).not.toContain("native-only-credential");
    expect(authorized).toBe(true);
    expect(bodies.join()).toContain("project folder");
    expect(bodies.join()).not.toContain("PRIVATE_OUTSIDE_VALUE");
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
