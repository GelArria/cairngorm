import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { bashTool } from "../tools/bash.js";

const fixture = fileURLToPath(new URL("./fixtures/bash-stream.mjs", import.meta.url));
const command = (code = 0, delay = 250) => `"${process.execPath}" "${fixture}" ${code} ${delay}`;

test("the shell tool advertises and executes the host shell syntax", async () => {
  const windows = process.platform === "win32";
  const expectedShell = windows ? "cmd.exe" : "bash";
  expect(bashTool.description).toContain(expectedShell);
  expect(JSON.stringify(bashTool.parameters.properties.command)).toContain(expectedShell);
  const result = await bashTool.execute("shell-syntax", {
    command: windows ? "if exist . (echo SHELL_SYNTAX_OK)" : "[ -d . ] && printf SHELL_SYNTAX_OK",
  });
  expect(result.details.exitCode).toBe(0);
  expect(result.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("SHELL_SYNTAX_OK"),
  });
});

test("bash streams cumulative stdout/stderr before completion and returns the exit code", async () => {
  const updates: string[] = [];
  const result = await bashTool.execute(
    "stream",
    { command: command(7), timeout: 5000 },
    undefined,
    (partial) => {
      const text = partial.content[0];
      if (text.type === "text") {
        updates.push(text.text);
      }
    },
  );
  expect(
    updates.some((text) => text.includes("first chunk") && !text.includes("second chunk")),
  ).toBe(true);
  expect(result.content[0]).toEqual({ type: "text", text: "first chunk\nsecond chunk\n" });
  expect(result.details.exitCode).toBe(7);
});

test("bash honors an already-aborted signal without launching a command", async () => {
  const result = await bashTool.execute("aborted", { command: command() }, AbortSignal.abort());
  expect(result.details.exitCode).toBe(130);
});

test("bash times out and cancels the running process tree", async () => {
  const result = await bashTool.execute("timeout", { command: command(0, 10000), timeout: 150 });
  expect(result.details.exitCode).toBe(124);
  expect(result.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("timed out"),
  });
}, 5000);
