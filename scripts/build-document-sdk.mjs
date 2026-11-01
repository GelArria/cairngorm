// Compiles the TypeScript document provider SDK and the sample provider.
//   node scripts/build-document-sdk.mjs          write generated files
//   node scripts/build-document-sdk.mjs --check  fail when they are out of date
// The native gateway embeds src/documents/sdk/generated/document-sdk.js at compile time,
// so the generated files are committed and checked by tests and `npm run build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = path.join(root, "src/documents/sdk");
const sdkSource = path.join(sdkDir, "document-sdk.ts");
const generated = path.join(sdkDir, "generated");
// Providers compiled from TypeScript with the SDK: the sample and the ones Cairngorm ships.
const providerDirs = [
  path.join(sdkDir, "sample-provider"),
  path.join(root, "src/documents/providers/spreadsheet"),
];
// Providers import the SDK relative to their entry module; this copy gives each its types.
const typesFor = (dir) => path.join(dir, "src/_cairngorm/document-sdk.d.ts");
const HEADER =
  "// Generated from document-sdk.ts by scripts/build-document-sdk.mjs. Do not edit.\n";

const sdkOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  strict: true,
  skipLibCheck: true,
  declaration: true,
  outDir: generated,
  newLine: ts.NewLineKind.LineFeed,
};

function fail(diagnostics) {
  const host = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}

/**
 * Type-checks `files` and returns what the compiler would write, keyed by absolute path.
 * `overrides` supplies in-memory files (the generated declarations) without touching disk.
 */
function compile(files, options, overrides = new Map()) {
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists } = host;
  host.fileExists = (file) => overrides.has(path.resolve(file)) || fileExists(file);
  const { directoryExists } = host;
  host.directoryExists = (dir) =>
    [...overrides.keys()].some((file) => file.startsWith(path.resolve(dir) + path.sep)) ||
    (directoryExists?.(dir) ?? ts.sys.directoryExists(dir));
  host.getSourceFile = (file, language, ...rest) => {
    const text = overrides.get(path.resolve(file));
    return text === undefined
      ? getSourceFile(file, language, ...rest)
      : ts.createSourceFile(file, text, language);
  };
  const program = ts.createProgram(files, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    fail(diagnostics);
  }
  const outputs = new Map();
  program.emit(undefined, (file, text) => outputs.set(path.resolve(file), text));
  return outputs;
}

function providerOutputs(dir, declarations) {
  const configPath = path.join(dir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    fail([config.error]);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
  if (parsed.errors.length) {
    fail(parsed.errors);
  }
  const options = { ...parsed.options, newLine: ts.NewLineKind.LineFeed };
  return compile(parsed.fileNames, options, declarations);
}

export function documentSdkOutputs() {
  const sdk = new Map(
    [...compile([sdkSource], sdkOptions)].map(([file, text]) => [file, HEADER + text]),
  );
  // Each provider is checked against the declarations an author would receive.
  const types = [...sdk].find(([file]) => file.endsWith(".d.ts"))[1];
  const outputs = new Map(sdk);
  for (const dir of providerDirs) {
    const declarations = new Map([[typesFor(dir), types]]);
    for (const [file, text] of [...declarations, ...providerOutputs(dir, declarations)]) {
      outputs.set(file, text);
    }
  }
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const stale = [];
  for (const [file, text] of documentSdkOutputs()) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (current === text) {
      continue;
    }
    if (check) {
      stale.push(path.relative(root, file));
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`wrote ${path.relative(root, file)}`);
    }
  }
  if (stale.length) {
    console.error(
      `Document SDK output is out of date: ${stale.join(", ")}\nRun node scripts/build-document-sdk.mjs`,
    );
    process.exit(1);
  }
}
