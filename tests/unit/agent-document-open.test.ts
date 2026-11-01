import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

import { openAgentDocument, type AgentOpenRequest } from "@/app/hooks/use-agent-document-open";
import { reloadProviders } from "@/documents/data/provider-registry";

let tickets: Record<string, Uint8Array> = {};
const request = (name: string, patch: Partial<AgentOpenRequest> = {}): AgentOpenRequest => ({
  ticket: `ticket-${name}`,
  project: "project-b",
  terminal: "term-b",
  path: `C:/Project B/${name}`,
  name,
  size: 3,
  sha256: "x",
  ...patch,
});
const tabs = () =>
  ({
    state: { groups: [{ id: "project-a" }, { id: "project-b" }] },
    openFileTab: vi.fn(() => "tab-1"),
  }) as any;
const acks = () =>
  native.invoke.mock.calls.filter(([cmd]) => cmd === "document_ticket_ack").map(([, args]) => args);

beforeEach(async () => {
  tickets = {};
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === "document_providers_list") {
      return [];
    }
    if (cmd === "document_ticket_read") {
      if (!tickets[args.ticket]) {
        throw new Error("gone");
      }
      return tickets[args.ticket].buffer;
    }
    return null;
  });
  await reloadProviders();
});

it("opens provider formats as documents in the source project with the ticket", async () => {
  const t = tabs();
  await openAgentDocument(t, request("Review.docx"));
  expect(t.openFileTab).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: "project-b",
      document: true,
      ticket: "ticket-Review.docx",
      fullPath: "C:/Project B/Review.docx",
    }),
  );
  expect(acks()).toEqual([{ ticket: "ticket-Review.docx", openedIn: "document", operations: [] }]);
  // Documents never read the snapshot here: the pane reads it.
  expect(native.invoke).not.toHaveBeenCalledWith("document_ticket_read", expect.anything());
});

it("opens UTF-8 text in the editor from the authorized bytes, not the path", async () => {
  tickets["ticket-notes.ts"] = new TextEncoder().encode("export const x = 1;");
  const t = tabs();
  await openAgentDocument(t, request("notes.ts"));
  expect(t.openFileTab).toHaveBeenCalledWith(
    expect.objectContaining({ content: "export const x = 1;", groupId: "project-b" }),
  );
  expect(t.openFileTab.mock.calls[0][0].document).toBeUndefined();
  expect(acks()[0].openedIn).toBe("editor");
});

it("shows images and routes unknown binaries to the no-provider pane", async () => {
  tickets["ticket-logo.png"] = new Uint8Array([137, 80, 78, 71]);
  tickets["ticket-data.bin"] = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
  const t = tabs();
  await openAgentDocument(t, request("logo.png"));
  await openAgentDocument(t, request("data.bin"));
  expect(t.openFileTab.mock.calls[0][0].imageSrc).toMatch(/^data:image\/png;base64,/);
  expect(t.openFileTab.mock.calls[1][0]).toMatchObject({
    document: true,
    ticket: "ticket-data.bin",
  });
});

it("refuses closed projects and reports failures to the waiting tool", async () => {
  const t = tabs();
  await openAgentDocument(t, request("Review.docx", { project: "closed" }));
  await openAgentDocument(t, request("missing.ts"));
  expect(t.openFileTab).not.toHaveBeenCalled();
  expect(acks().map((ack) => Boolean(ack.error))).toEqual([true, true]);
});
