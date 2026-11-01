# Document providers (SDK v1)

A document provider teaches Cairngorm to show a file type inside its own panes. Cairngorm
owns the session (which file, its bytes, versions, lifecycle and saving); the provider owns
interpretation and its view. Adding a provider never requires changing or rebuilding
Cairngorm.

Every provider receives a bounded snapshot of the document and renders it. A provider that
declares `"edit"` can also hand changed bytes back; Cairngorm saves them (version check,
backup, atomic replace). A provider can declare typed `operations` that agents run through
Cairngorm's MCP on documents already open in a pane.

## Folder layout

```text
my-provider/
  cairngorm-provider.json   # manifest (required)
  index.html                # the entry page named by the manifest
  main.js                   # compiled from TypeScript
  src/main.ts               # your source
  src/_cairngorm/document-sdk.d.ts   # SDK types, copied from Cairngorm
  tsconfig.json
```

A complete example lives in `src/documents/sdk/sample-provider/` (it opens `.sample` files).

## Manifest

```json
{
  "protocol": "cairngorm.document-provider/1",
  "id": "com.example.viewer",
  "name": "Example viewer",
  "version": "1.0.0",
  "description": "Optional, up to 280 characters.",
  "entry": "index.html",
  "fileTypes": [{ "label": "Example", "extensions": ["example"], "mimeTypes": ["text/x-example"] }],
  "capabilities": ["view", "edit"],
  "maxBytes": 1048576,
  "operations": [
    {
      "name": "set-field",
      "description": "Change the value of one existing field.",
      "inputSchema": { "type": "object", "properties": { "key": { "type": "string" } } }
    }
  ]
}
```

- `id`: lowercase reverse-DNS; `cairngorm.*` is reserved for built-ins.
- `extensions`: one provider may declare up to 32. An extension is a routing hint only.
- `template` (optional, per file type): a blank document inside your folder, such as
  `"blank.xlsx"`. With it, agents can create new files of that type (`cairngorm_create_file`).
- `capabilities`: `"view"` (required) and optionally `"edit"`. Unknown fields, capabilities or
  permissions are refused.
- `operations`: up to 16, each a lowercase hyphenated `name`, a `description` and an object
  `inputSchema` (at most 8 KiB). Agents see them when they open the document; your view
  validates the arguments.
- `maxBytes`: largest document you accept (default 16 MiB, at most 32 MiB). Larger files show
  an error before any byte is read.

## Writing the view in TypeScript

```ts
import { connect } from "./_cairngorm/document-sdk.js";

const host = await connect();
render(await host.readText()); // or host.read() for bytes
host.ready();
host.onDocumentChange(async () => render(await host.readText()));
host.onContextChange((context) => applyTheme(context.theme, context.colors));
host.onTeardown(() => saveScrollPosition());
```

Compile `src/main.ts` to `main.js` with `tsc` (or any bundler, keeping
`./_cairngorm/document-sdk.js` external). Cairngorm serves the SDK at that path next to
every provider, so its version always matches the host. Copy the types from
`src/documents/sdk/generated/document-sdk.d.ts`.

| API                      | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `host.document`          | name, extension, MIME type, size and content `version`     |
| `host.read()`            | the current bytes (`Uint8Array`); call again after changes |
| `host.ready()`           | rendering finished; Cairngorm removes its loading state    |
| `host.reportError(e)`    | shows a recoverable error in the pane                      |
| `onDocumentChange`       | the file was reloaded with different content               |
| `onContextChange`        | theme, colors or pane size changed                         |
| `onTeardown`             | the pane is closing (two seconds at most)                  |
| `host.capabilities.edit` | this session can save (edit declared and a file on disk)   |
| `host.setDirty(bool)`    | shows or clears "Unsaved changes" in the pane and tab      |
| `onSave(handler)`        | return the bytes (or text) to save when the user saves     |
| `onSaved`                | Cairngorm committed the save; `document.version` is new    |
| `onOperation(name, fn)`  | implements a declared operation; return JSON               |

Report `ready()` within 15 seconds or the pane shows that the provider did not load.

## Saving and conflicts

The user saves with the pane's **Save** button or Ctrl+S. Cairngorm asks your `onSave`
handler for the bytes, checks that the file on disk still has the version you were given,
keeps a private backup of the original (the newest 20 per app data folder), writes a sibling
temporary file and replaces the original. If the file changed meanwhile, another program
holds it, or anything fails, the original is untouched and the pane keeps your unsaved state.
Reloading or switching provider with unsaved changes asks the user first. A document can move
into its own window (drag its tab out, or **Open in new window**); the same provider view,
saving and agent operations work there, and closing the window returns it to the main window.

## Agents

The flow is: the user asks an agent → the agent finds Cairngorm's MCP tools → it creates or
opens the file → the user sees it in a Cairngorm pane while the agent edits it.

File tools ask the user the first time an agent in a terminal uses them (Always allow / Allow
for this terminal / Don't allow; Settings ▸ Plugins ▸ File access changes this: Ask first,
Always or Off).

`cairngorm_create_file` creates a new file inside the terminal's project from the template of
the provider that opens its extension (included editors first), never overwriting, and opens
it like `cairngorm_open_file`.

Agents connected to Cairngorm's MCP can call `cairngorm_open_file`: the file is authorized
like `cairngorm_read_file`, its bytes are kept as an immutable snapshot, and the pane opens in
the agent terminal's own project (without switching the user's view). The result lists your
operations. `cairngorm_document_operation` then runs one of them in that pane; with
`save: true` Cairngorm saves afterwards, but never while the user has unsaved changes there.

## What a provider can and cannot do

Providers run in a sandboxed iframe on their own loopback origin (one per provider and
project), inside a Cairngorm relay frame on a sibling origin that may embed only that provider.
The provider therefore cannot navigate its frame anywhere else. The CSP allows scripts, styles, fetches and workers only from the provider's own
files, and no frames, forms, popups or downloads. Cairngorm removes the WebRTC constructors
before any provider script runs, so peer connections cannot carry data past the CSP. Providers
never receive a file path, Tauri APIs, other files or the ability to save. Render document
data as text (`textContent`), not markup.

## Installing

Settings ▸ Documents ▸ **Add an editor…**, choose the folder, review what it declares and
approve. The approval covers a hash of every file in the folder, and Cairngorm copies exactly
those bytes into its private data folder (512 files and 32 MiB at most; links and
dot-entries are refused or skipped). Later edits to the original
folder have no effect until you install it again; a copied folder that changes afterwards is
listed as broken and never loads (checked whenever the provider list is refreshed).

Extensions Cairngorm edits as text or code (for example `.md`, `.json`, `.ts`, `.ipynb`)
cannot be claimed by a provider.

Settings ▸ Documents ▸ **File types** lists every extension with the editor that opens it. When
several providers open the same extension, an included editor is the default; otherwise
Cairngorm asks the first time and remembers the choice (change it with **Open with** there or
in each pane's header).

## Included with Cairngorm

Some providers ship inside the app (`src/documents/native/document_bundled.rs` embeds their
compiled files). They are installed automatically the first time the provider list loads,
through the normal validation and install path from a staging copy. Removing one is
remembered (`.bundled-removed.json`); it can be added back from Settings ▸ Documents ▸
**Included with Cairngorm** or from a catalog application whose entry sets
`documentProvider` (Microsoft Excel ▸ **+**). Ids starting
with `app.cairngorm.` are reserved for these bundles (a folder you pick cannot use one), so
when a new Cairngorm build ships different bytes, the added provider is replaced on the next
start without asking again.

- **Spreadsheet editor** (`src/documents/providers/spreadsheet/`, `.xlsx`): views and edits
  cell values and formulas without Excel. Saving rewrites only the changed worksheets and
  copies every other part of the package byte for byte. Formulas are not calculated in the
  pane; the workbook is marked for a full recalculation the next time Excel opens it. Cells
  other parts depend on (shared/array formula anchors, array ranges, table headers) cannot be
  edited, inputs that would corrupt the file (control characters, malformed formulas,
  oversized text) are refused, and formatting is read-only. Agent writes are all or nothing.
  Agents can call its `list-sheets`, `read-range` and `set-cells` operations, and create new
  workbooks from its `blank.xlsx` template.

## Developing the SDK

`src/documents/sdk/document-sdk.ts` is the source. Run `npm run build:document-sdk` after
editing it or the sample; `npm run build` and the unit tests fail when the generated files
are stale.
