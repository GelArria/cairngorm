import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  clear: () => storage.clear(),
});
vi.mock("@tauri-apps/api/core", () => native);

import { getProviderChoice } from "@/documents/data/provider-preferences";
import { reloadProviders } from "@/documents/data/provider-registry";
import { DocumentPane } from "@/documents/document-pane";

const tableRow = {
  id: "com.example.tables",
  error: null,
  manifest: {
    id: "com.example.tables",
    name: "Example tables",
    version: "1.0.0",
    fileTypes: [{ label: "CSV", extensions: ["csv"], mimeTypes: [] }],
    capabilities: ["view"],
    maxBytes: 1024,
  },
};
let files: Record<string, string> = {};
let installed: unknown[] = [];

beforeEach(async () => {
  localStorage.clear();
  native.invoke.mockClear();
  files = { "C:/data.csv": "Name,Count\nalpha,3", "C:/big.csv": "x".repeat(10) };
  installed = [];
  native.invoke.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === "document_providers_list") {
      return installed;
    }
    if (cmd === "document_read_snapshot") {
      const text = files[args.path];
      if (text === undefined) {
        throw new Error("not found");
      }
      if (text.length > args.maxBytes) {
        throw new Error("The document is too large to open.");
      }
      return new TextEncoder().encode(text).buffer;
    }
    if (cmd === "document_view_url") {
      return "http://d-0123456789abcdef0123456789abcdef.localhost:4321/index.html";
    }
    return null;
  });
  await reloadProviders();
});
afterEach(cleanup);

const pane = (patch: Partial<Parameters<typeof DocumentPane>[0]> = {}) => {
  const onProviderChange = vi.fn();
  const view = render(
    <DocumentPane
      title="data.csv"
      extension="csv"
      path="C:/data.csv"
      scope="project-a"
      onProviderChange={onProviderChange}
      {...patch}
    />,
  );
  return { ...view, onProviderChange };
};

it("renders a built-in provider with a read-only header and reloads from disk", async () => {
  pane();
  await waitFor(() => expect(screen.getByRole("cell", { name: "alpha" })).toBeTruthy());
  expect(screen.getByText("Read-only")).toBeTruthy();
  expect(screen.getByText(/CSV table · Spreadsheet preview/)).toBeTruthy();
  files["C:/data.csv"] = "Name,Count\nbeta,4";
  fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
  await waitFor(() => expect(screen.getByRole("cell", { name: "beta" })).toBeTruthy());
});

it("asks once when several providers match and remembers the choice", async () => {
  installed = [tableRow];
  await reloadProviders();
  const { onProviderChange } = pane();
  await waitFor(() => expect(screen.getByTestId("document-provider-chooser")).toBeTruthy());
  fireEvent.click(screen.getByRole("radio", { name: /Example tables/ }));
  fireEvent.click(screen.getByTestId("document-provider-open"));
  expect(onProviderChange).toHaveBeenCalledWith("com.example.tables");
  expect(getProviderChoice("csv")).toBe("com.example.tables");
});

it("shows an honest no-provider state for unknown formats", async () => {
  pane({ title: "a.zzz", extension: "zzz", path: "C:/a.zzz" });
  await waitFor(() => expect(screen.getByTestId("document-no-provider")).toBeTruthy());
  expect(native.invoke).not.toHaveBeenCalledWith("document_read_snapshot", expect.anything());
});

it("reports read failures inside the pane", async () => {
  pane({ path: "C:/missing.csv" });
  await waitFor(() =>
    expect(screen.getByTestId("document-error").textContent).toContain("not found"),
  );
});

it("opens installed providers in an isolated frame with no Tauri access", async () => {
  installed = [tableRow];
  await reloadProviders();
  pane({ providerId: "com.example.tables" });
  const frame = await screen.findByTestId("document-provider-frame");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  await waitFor(() => expect(frame.getAttribute("src")).toContain(".localhost:4321/index.html"));
  expect(native.invoke).toHaveBeenCalledWith("document_view_url", {
    provider: "com.example.tables",
    scope: "project-a",
  });
});
