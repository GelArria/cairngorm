import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { detectLanguage, loadLanguage } from "@/editor/components/code-editor/languages";

describe("editor language coverage", () => {
  it.each([
    [".SQL", "migration.SQL", "SQL"],
    ["cs", "Main.cs", "C#"],
    ["go", "main.go", "Go"],
    ["ps1", "setup.ps1", "PowerShell"],
    ["tsx", "App.tsx", "TSX"],
    ["mts", "main.mts", "TypeScript"],
    ["", "Dockerfile", "Dockerfile"],
    ["txt", "CMakeLists.txt", "CMake"],
    ["", "Jenkinsfile", "Groovy"],
    ["", "Gemfile", "Ruby"],
    ["local", ".env.local", "Shell"],
    ["zshrc", ".zshrc", "Shell"],
    ["csproj", "C:\\project\\app.csproj", "XML"],
    ["toml", "Cargo.toml", "TOML"],
    ["vue", "App.vue", "Vue"],
  ])("detects %s / %s", (ext, filename, expected) => {
    expect(detectLanguage(ext, filename)?.name).toBe(expected);
  });

  it("supports every registered extension and filename pattern", () => {
    for (const description of languages) {
      for (const ext of description.extensions) {
        expect(detectLanguage(ext, `sample.${ext}`), ext).not.toBeNull();
      }
    }
    expect(detectLanguage("", "C:/project/Dockerfile")?.name).toBe("Dockerfile");
  });

  it("loads every grammar successfully", async () => {
    for (const description of languages) {
      expect(await description.load(), description.name).toBeTruthy();
    }
  }, 30000);

  it("parses SQL and caches its support", async () => {
    const support = await loadLanguage("sql", "migration.sql");
    expect(await loadLanguage("SQL")).toBe(support);
    const state = EditorState.create({
      doc: "SELECT id FROM users WHERE id = 42;",
      extensions: support!,
    });
    const tree = ensureSyntaxTree(state, state.doc.length, 1000);
    expect(tree?.toString()).toContain("Keyword");
  });

  it("leaves unknown files as editable plain text", async () => {
    expect(await loadLanguage("unknown", "file.unknown")).toBeNull();
    expect(await loadLanguage("", "LICENSE")).toBeNull();
  });
});
