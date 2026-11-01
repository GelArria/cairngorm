import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const root = path.resolve("src");
function sourceFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory())
      return ["core", "native", "node_modules", "__tests__"].includes(entry.name)
        ? []
        : sourceFiles(file);
    return /\.(?:tsx?|[cm]?js)$/.test(file) ? [file] : [];
  });
}

// Feature-specific invariants keep cross-feature coordination in app.
it.each([
  ["projects", ["app", "terminal", "calendar"]],
  ["calendar", ["app", "projects", "terminal"]],
  ["terminal", ["app", "sidebar"]],
  ["git", ["app", "sidebar"]],
] as const)(
  "%s does not import the features coordinated by its app caller",
  (feature, forbidden) => {
    const violations: string[] = [];
    for (const file of sourceFiles(path.join(root, feature))) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        const spec =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
        if (spec && ts.isStringLiteral(spec)) {
          const target = spec.text.startsWith("@/")
            ? path.join(root, spec.text.slice(2))
            : spec.text.startsWith(".")
              ? path.resolve(path.dirname(file), spec.text)
              : null;
          const owner = target && path.relative(root, target).split(path.sep)[0];
          if (owner && (forbidden as readonly string[]).includes(owner))
            violations.push(`${path.relative(root, file)} -> ${spec.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(violations).toEqual([]);
  },
);

it("browser-side source imports still point to real modules", () => {
  const violations: string[] = [];
  const files = [root, path.resolve("tests"), path.resolve("tests/native")].flatMap(sourceFiles);
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node)) {
        const modulePath = node.text.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/, "");
        if (modulePath.startsWith("/src/") && /\.[cm]?[jt]sx?$/.test(modulePath)) {
          if (!fs.existsSync(path.resolve(modulePath.slice(1)))) {
            violations.push(`${path.relative(process.cwd(), file)} -> ${node.text}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});

it.each(["model", "data", "hooks"])("%s modules do not render UI", (layer) => {
  const violations: string[] = [];
  for (const file of sourceFiles(root)) {
    if (!path.relative(root, file).split(path.sep).includes(layer)) continue;
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        violations.push(`${path.relative(root, file)}: JSX belongs in a component`);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly =
          clause?.isTypeOnly ||
          (!clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.every((item) => item.isTypeOnly));
        if (!typeOnly && layer !== "hooks") {
          const spec = node.moduleSpecifier.text;
          if (spec === "preact/hooks" || /(?:^|\/)(?:components|ui)(?:\/|$)/.test(spec)) {
            violations.push(`${path.relative(root, file)} -> ${spec}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
