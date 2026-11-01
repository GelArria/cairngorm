import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

// Filename detection must precede extension detection (e.g. CMakeLists.txt).
const aliases: Record<string, string> = {
  zsh: "Shell",
  bashrc: "Shell",
  zshrc: "Shell",
  profile: "Shell",
  bash_profile: "Shell",
  env: "Shell",
  "env.local": "Shell",
  containerfile: "Dockerfile",
  dockerfile: "Dockerfile",
  jsonc: "JSON",
  json5: "JSON",
  csproj: "XML",
  fsproj: "XML",
  vbproj: "XML",
  props: "XML",
  targets: "XML",
};

export function detectLanguage(language: string, filename?: string): LanguageDescription | null {
  const name = filename?.split(/[\\/]/).pop() ?? "";
  const ext = language.toLowerCase().replace(/^\./, "");
  const named = name && LanguageDescription.matchFilename(languages, name);
  if (named) {
    return named;
  }
  const alias = /^\.env(?:\.|$)/i.test(name)
    ? "Shell"
    : (aliases[name.toLowerCase().replace(/^\./, "")] ?? aliases[ext]);
  return (
    (alias && LanguageDescription.matchLanguageName(languages, alias, false)) ||
    LanguageDescription.matchFilename(languages, `file.${ext}`) ||
    LanguageDescription.matchLanguageName(languages, ext, false)
  );
}

export async function loadLanguage(
  language: string,
  filename?: string,
): Promise<LanguageSupport | null> {
  return (await detectLanguage(language, filename)?.load()) ?? null;
}
