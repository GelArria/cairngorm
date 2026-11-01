// A complete document provider for `.sample` files: it renders, edits field values and
// exposes two operations agents can run through Cairngorm.
//
// Build: node scripts/build-document-sdk.mjs (compiles src/*.ts beside index.html).
import { connect, type DocumentHost, type HostContext } from "./_cairngorm/document-sdk.js";
import { parseSample, serializeSample, type SampleDocument } from "./format.js";

let sample: SampleDocument = { title: "", fields: [], paragraphs: [] };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }
  if (className) {
    node.className = className;
  }
  return node;
}

/** Text content and input values only: document data never becomes markup. */
function render(host: DocumentHost) {
  const root = document.getElementById("document")!;
  const fields = element("dl");
  sample.fields.forEach(([key], index) => {
    const value = document.createElement("input");
    value.value = sample.fields[index][1];
    value.readOnly = !host.capabilities.edit;
    value.setAttribute("aria-label", key);
    value.addEventListener("input", () => {
      sample.fields[index][1] = value.value;
      host.setDirty(true);
    });
    const cell = element("dd");
    cell.append(value);
    fields.append(element("dt", key), cell);
  });
  root.replaceChildren(
    element("h1", sample.title || host.document.name),
    element("p", `${host.document.name} · ${sample.fields.length} fields`, "meta"),
    fields,
    ...sample.paragraphs.map((text) => element("p", text)),
  );
}

function applyTheme(context: HostContext) {
  const style = document.documentElement.style;
  style.colorScheme = context.theme ?? "light";
  const colors = context.colors ?? {};
  for (const [name, token] of [
    ["background", "--background"],
    ["foreground", "--foreground"],
    ["mutedForeground", "--muted"],
    ["border", "--border"],
    ["accent", "--accent"],
  ] as const) {
    if (colors[name]) {
      style.setProperty(token, colors[name]);
    }
  }
}

async function main() {
  const host = await connect();
  applyTheme(host.context);
  host.onContextChange(applyTheme);
  const show = async () => {
    try {
      sample = parseSample(await host.readText());
      render(host);
      host.ready();
    } catch (error) {
      host.reportError(error);
    }
  };
  host.onDocumentChange(() => void show());
  host.onSave(() => serializeSample(sample));
  host.onSaved(() => host.setDirty(false));
  host.onOperation("list-fields", () => Object.fromEntries(sample.fields));
  host.onOperation("set-field", (args) => {
    const key = String(args.key ?? "");
    const field = sample.fields.find(([name]) => name === key);
    if (!field) {
      throw new Error(`No field named "${key}".`);
    }
    field[1] = String(args.value ?? "");
    render(host);
    host.setDirty(true);
    return { key, value: field[1] };
  });
  await show();
}

void main();
