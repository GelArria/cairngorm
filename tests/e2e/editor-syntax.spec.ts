import { test, expect, openFileInGrid } from "./fixtures";

test("SQL is colored and remains editable; extensionless Dockerfile is colored", async ({
  app,
}) => {
  await openFileInGrid(
    app,
    {
      title: "apply-avatars-storage.sql",
      path: ["apply-avatars-storage.sql"],
      extension: "sql",
      content:
        "-- Public avatars bucket\nINSERT INTO storage.buckets (id, name, public)\nVALUES ('avatars', 'avatars', true)\nON CONFLICT (id) DO UPDATE SET public = true;\n\nCREATE POLICY \"avatars upload own\" ON storage.objects\nFOR INSERT TO authenticated\nWITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = owner_id);",
    },
    ".cm-editor",
  );
  const editor = app.getByTestId("code-editor").first();
  await expect.poll(() => editor.locator(".cm-line span").count()).toBeGreaterThan(10);
  const colors = await editor
    .locator(".cm-line span")
    .evaluateAll((spans) => [...new Set(spans.map((span) => getComputedStyle(span).color))]);
  expect(colors.length).toBeGreaterThan(2);
  await expect(app.getByTestId("splash")).toHaveCount(0, { timeout: 15000 });
  await editor.screenshot({ path: "logs/e2e/editor-syntax-sql.png" });
  await editor.locator(".cm-content").click();
  await app.keyboard.press("Control+End");
  await app.keyboard.type("\nSELECT 42;");
  await expect(editor).toContainText("SELECT 42;");

  await openFileInGrid(
    app,
    {
      title: "Dockerfile",
      path: ["Dockerfile"],
      extension: "",
      content: 'FROM node:22\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["npm", "start"]',
    },
    ".cm-editor:visible",
  );
  const docker = app.getByTestId("code-editor").filter({ hasText: "FROM node:22" });
  await expect.poll(() => docker.locator(".cm-line span").count()).toBeGreaterThan(3);
  await docker.screenshot({ path: "logs/e2e/editor-syntax-dockerfile.png" });
});
