// cairngorm.json in the frontend: a synchronous snapshot for preferences (mirrored in
// localStorage so the first render has it), edits that keep the user's comments, and live
// updates when the file changes anywhere (another window or an external editor).
// Every save re-reads the file first, so windows never overwrite each other's changes.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ConfigData = Record<string, unknown>;

interface ConfigFile {
  path: string;
  text: string | null;
}

const MIRROR = "cairngorm.config.mirror.v1";
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
const SYNTAX = "cairngorm.json has a syntax error; fix it to change settings here.";
const listeners = new Set<() => void>();
let data: ConfigData = readMirror();
let filePath = "";
let error = "";
/** The file on disk does not parse: screens must not save over it. */
let invalid = false;
let writes = 0;
let queue: Promise<unknown> = Promise.resolve();
const jsonc = () => import("jsonc-parser");
const notify = () => listeners.forEach((listener) => listener());

function readMirror(): ConfigData {
  try {
    const value = JSON.parse(localStorage.getItem(MIRROR) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function publish(next: ConfigData) {
  if (JSON.stringify(next) === JSON.stringify(data)) return;
  data = next;
  try {
    localStorage.setItem(MIRROR, JSON.stringify(next));
  } catch {
    // The file stays the source of truth.
  }
  notify();
}

/** Parses JSON with comments; `null` when it is not a valid object. */
export async function parseConfig(source: string): Promise<ConfigData | null> {
  const { parse } = await jsonc();
  const errors: import("jsonc-parser").ParseError[] = [];
  const value = parse(source.replace(/^﻿/, ""), errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ConfigData;
}

export const getConfig = (): ConfigData => data;
export const getConfigPath = () => filePath;
export const getConfigError = () => error;

export function subscribeConfig(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(task);
  queue = run;
  return run;
}

async function readFile(): Promise<string | null> {
  const file = await invoke<ConfigFile>("config_read");
  filePath = file.path;
  return file.text === null ? null : file.text.replace(/^﻿/, "");
}

function createText(initial: ConfigData) {
  const header =
    "// Cairngorm settings. Add to, hide or change what Cairngorm detects.\n" +
    "// Permissions are granted only in Cairngorm's dialogs, never here.\n";
  return `${header}${JSON.stringify({ $schema: "./cairngorm.schema.json", ...initial }, null, 2)}\n`;
}

/**
 * Reads the file. `create` (only the main window passes it) makes a missing file, from
 * `create()`'s contents; other windows wait for it.
 */
export function loadConfig(create?: () => ConfigData) {
  return enqueue(async () => {
    let text = await readFile();
    if (text === null) {
      if (!create) return;
      text = createText(create());
      await invoke("config_write", { text });
    }
    const parsed = await parseConfig(text);
    invalid = !parsed;
    error = parsed ? "" : SYNTAX;
    // A change made here and not yet saved wins over what the file said a moment ago.
    if (parsed && writes === 0) publish(parsed);
    notify();
  });
}

/** A copy of `source` with `value` at `path` (`undefined` removes it). */
function setIn(source: ConfigData, path: string[], value: unknown): ConfigData {
  const [key, ...rest] = path;
  const copy: ConfigData = { ...source };
  if (!rest.length) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  }
  const child = copy[key];
  copy[key] = setIn(
    child && typeof child === "object" && !Array.isArray(child) ? (child as ConfigData) : {},
    rest,
    value,
  );
  return copy;
}

/** Sets one value (`undefined` removes it), keeping the rest of the file and its comments. */
export function updateConfig(path: string[], value: unknown): Promise<void> {
  if (invalid) {
    error = SYNTAX;
    notify();
    return Promise.reject(new Error(SYNTAX));
  }
  // In use at once; the save is queued and applied to the file as it is on disk then.
  publish(setIn(data, path, value));
  writes += 1;
  return enqueue(async () => {
    try {
      const { applyEdits, modify } = await jsonc();
      const current = (await readFile()) ?? createText({});
      if (!(await parseConfig(current))) {
        invalid = true;
        throw new Error(SYNTAX);
      }
      let next: string;
      try {
        next = applyEdits(current, modify(current, path, value, FORMAT));
      } catch (cause) {
        if (value === undefined) return; // Removing something that is not there.
        throw cause;
      }
      await invoke("config_write", { text: next });
      error = "";
    } catch (cause) {
      error = invalid ? SYNTAX : `cairngorm.json could not be saved: ${String(cause)}`;
      notify();
      throw cause;
    } finally {
      writes -= 1;
    }
  });
}

let watching = false;
/** Reloads whenever the file changes (native watcher), e.g. after editing it by hand. */
export function watchConfig(create?: () => ConfigData) {
  if (watching) return;
  watching = true;
  listen("config-changed", () => {
    loadConfig(create).catch((cause) => {
      error = `cairngorm.json could not be read: ${String(cause)}`;
      notify();
    });
  }).catch(() => {});
}
