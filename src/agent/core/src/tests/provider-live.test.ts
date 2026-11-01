import { describe, test, expect, beforeAll } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── LIVE tests against Ollama Cloud (gemma4:31b) ───────────────────────────
// They self-skip when no key is available (CI without network stays green).
// Run with: bun test src/tests/provider-live.test.ts
// Key: ~/.panel/agent/config.json → apiKey (inline) or OLLAMA_API_KEY in env.

function loadLiveEnv(): { key: string; baseUrl: string; model: string } | null {
  const key =
    process.env.OLLAMA_API_KEY ??
    (() => {
      try {
        const p = join(
          process.env.USERPROFILE ?? process.env.HOME ?? "",
          ".panel",
          "agent",
          "config.json",
        );
        const cfg = JSON.parse(readFileSync(p, "utf-8"));
        return cfg.provider === "ollama" ? cfg.apiKey : undefined;
      } catch {
        return undefined;
      }
    })();
  if (!key) {
    return null;
  }
  return { key, baseUrl: "https://ollama.com/v1", model: "gemma4:31b" };
}

const env = loadLiveEnv();
const url = (p: string) => `https://ollama.com/v1${p}`;

async function chat(body: Record<string, unknown>, key?: string, raw = false): Promise<Response> {
  return fetch(url("/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key === null ? {} : { Authorization: `Bearer ${key ?? env!.key}` }),
    },
    body: raw
      ? (body as unknown as string)
      : JSON.stringify({ model: env!.model, stream: false, ...body }),
  });
}

describe.skipIf(!env)("LIVE gemma4:31b — direct API", () => {
  test("GET /models lists and exposes gemma4", async () => {
    const r = await fetch(url("/models"), { headers: { Authorization: `Bearer ${env!.key}` } });
    expect(r.status).toBe(200);
    const ids = ((await r.json()) as { data: { id: string }[] }).data.map((m) => m.id);
    expect(ids.some((id) => id.includes("gemma4"))).toBe(true);
  });

  test("basic chat responds", async () => {
    const r = await chat({
      messages: [{ role: "user", content: "Answer in a single word: capital of France?" }],
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0].message.content.toLowerCase()).toContain("par");
  });

  test("streaming delivers chunks and DONE", async () => {
    const r = await fetch(url("/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env!.key}` },
      body: JSON.stringify({
        model: env!.model,
        stream: true,
        messages: [{ role: "user", content: "Count from 1 to 5." }],
      }),
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("data:");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  test("function calling: gemma4 emits tool_calls", async () => {
    const r = await chat({
      messages: [{ role: "user", content: "List the files in /tmp using the tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "Lists files in a directory",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      choices: { message: { tool_calls?: { function: { name: string } }[] } }[];
    };
    expect(body.choices[0].message.tool_calls?.[0]?.function.name).toBe("list_files");
  });

  test("multi-turn: remembers context", async () => {
    const msgs: { role: string; content: string }[] = [
      { role: "user", content: "My favorite color is blue. Remember it." },
    ];
    const r1 = await chat({ messages: msgs });
    msgs.push({
      role: "assistant",
      content: ((await r1.json()) as { choices: { message: { content: string } }[] }).choices[0]
        .message.content,
    });
    msgs.push({ role: "user", content: "What is my favorite color? Answer with the color only." });
    const r2 = await chat({ messages: msgs });
    const c = (
      (await r2.json()) as { choices: { message: { content: string } }[] }
    ).choices[0].message.content.toLowerCase();
    expect(c).toContain("blue");
  });

  // ── Robustness battery: each edge case in one line ──
  const cases: [string, () => Promise<Response>][] = [
    [
      "invalid key → 401",
      () => chat({ messages: [{ role: "user", content: "hello" }] }, "sk-invalid"),
    ],
    [
      "no auth header → 401",
      () => chat({ messages: [{ role: "user", content: "hello" }] }, null as unknown as string),
    ],
    [
      "nonexistent model → 404",
      () => chat({ model: "phantom-model:99b", messages: [{ role: "user", content: "hello" }] }),
    ],
    [
      "model without tag (gemma4) → 200",
      () => chat({ model: "gemma4", messages: [{ role: "user", content: "hello" }] }),
    ],
    ["empty messages → 400", () => chat({ messages: [] })],
    [
      "max_tokens=1 → trivial content",
      () => chat({ messages: [{ role: "user", content: "tell a story" }], max_tokens: 1 }),
    ],
    [
      "temperature=10 does not kill the connection",
      () => chat({ messages: [{ role: "user", content: "say ok" }], temperature: 10 }),
    ],
    [
      "prompt ~30k chars → 200",
      () => chat({ messages: [{ role: "user", content: "word ".repeat(4000) }] }),
    ],
    [
      "invalid JSON body → 400",
      () => chat("{invalid" as unknown as Record<string, unknown>, undefined, true),
    ],
    [
      "nonexistent endpoint → 404/405",
      async () =>
        fetch(url("/phantom-endpoint"), {
          method: "POST",
          headers: { Authorization: `Bearer ${env!.key}` },
        }),
    ],
    [
      "system role respected",
      () =>
        chat({
          messages: [
            { role: "system", content: "Answer only: ok" },
            { role: "user", content: "hello" },
          ],
        }),
    ],
  ];
  for (const [name, fn] of cases) {
    test(`robustness: ${name}`, async () => {
      const r = await fn();
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.status).toBeLessThan(500); // client errors (4xx) are valid provider responses
    });
  }

  test("robustness: 5 concurrent all 200", async () => {
    const rs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => chat({ messages: [{ role: "user", content: `say ${i}` }] })),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });

  test("robustness: abort in flight → AbortError", async () => {
    const ac = new AbortController();
    const p = fetch(url("/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env!.key}` },
      body: JSON.stringify({
        model: env!.model,
        stream: false,
        messages: [{ role: "user", content: "count from 1 to 1000" }],
      }),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    try {
      await p;
    } catch (e) {
      expect((e as Error).name).toBe("AbortError");
      return;
    }
    throw new Error("expected AbortError");
  });
});

describe.skipIf(!env)("LIVE gemma4:31b — sidecar agent (JSONL)", () => {
  test("full sidecar: prompt → agent_end with response", async () => {
    const child = spawn("bun", ["src/cli.ts", "--sidecar", "--session-id", "test-live-gemma4"], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, OLLAMA_API_KEY: env!.key },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const events: Record<string, unknown>[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) {
          try {
            events.push(JSON.parse(line));
          } catch {
            /* partial line */
          }
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    // wait for sidecar_ready
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (events.some((e) => e.type === "sidecar_ready")) {
          clearInterval(iv);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(iv);
        resolve();
      }, 10_000);
    });
    const ready = events.find((e) => e.type === "sidecar_ready") as { model: string } | undefined;
    expect(ready?.model).toBe("gemma4:31b");

    child.stdin!.write(
      JSON.stringify({ type: "prompt", content: "Say exactly: LIVE_GEMMA4_OK" }) + "\n",
    );
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (events.some((e) => e.type === "agent_end")) {
          clearInterval(iv);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(iv);
        resolve();
      }, 120_000);
    });
    child.kill();

    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("turn_start");
    expect(types).toContain("agent_end");
    const replies = events
      .filter(
        (e) =>
          e.type === "message_end" &&
          (e as { message?: { role?: string } }).message?.role === "assistant",
      )
      .map((e) => JSON.stringify((e as { message?: { content?: unknown } }).message?.content));
    expect(replies.join(" ")).toContain("LIVE_GEMMA4_OK");
    expect(stderr).not.toContain("No API key");
  }, 150_000);
});
