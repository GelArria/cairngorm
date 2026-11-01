import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { docxFixture } from "../fixtures/docx";
import { SEED_INIT } from "../mocks/tauri-seed";

export { test, expect };
export const DOCX_PATH = "C:/Project With Spaces/Review.final.日本語.DOCX";
export const dataUrl = (bytes: Uint8Array) =>
  `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(bytes).toString("base64")}`;

/** Registers the mocked document workspace for the calling spec file. */
export function useDocumentFixtures() {
  beforeEach(async ({ app, browser, screen }) => {
    await browser.addInitScript(SEED_INIT);
    await browser.addInitScript(
      ({ path, src }) => {
        if (!location.protocol.startsWith("http")) {
          return;
        }
        localStorage.setItem("show-splash", "false");
        localStorage.setItem("sidebar-side", "left");
        localStorage.setItem("active-project-id", "docx-a");
        const w = window as any;
        const original = w.__TAURI_INTERNALS__.invoke;
        w.__docxSource = src;
        w.__docxCalls = [];
        w.__externalOpens = [];
        w.open = (...args: unknown[]) => {
          w.__externalOpens.push(args);
          return null;
        };
        w.__openDocx = (name = "Review.final.日本語.DOCX", source?: string) =>
          window.dispatchEvent(
            new CustomEvent("editor-open-file", {
              detail: {
                title: name,
                path: [name],
                fullPath: `C:/Project With Spaces/${name}`,
                content: "",
                extension: "docx",
                binarySrc: source,
                document: true,
              },
            }),
          );
        w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any, options?: unknown) => {
          w.__docxCalls.push({ cmd, args });
          if (cmd === "plugin:sql|select" && /FROM\s+projects\b/i.test(args.query)) {
            return Promise.resolve(
              ["a", "b"].map((id) => ({
                id: `docx-${id}`,
                name: `Documents ${id.toUpperCase()}`,
                root_path: id === "a" ? "C:/Project With Spaces" : "C:/Other Project",
                color: null,
                background: null,
                gem_cut: null,
                created_at: "2026-10-21 00:00:00",
              })),
            );
          }
          if (cmd === "fs_list_dir") {
            return Promise.resolve([
              { name: "Review.final.日本語.DOCX", path, isDirectory: false, size: 4096 },
            ]);
          }
          if (cmd === "document_providers_list") {
            return Promise.resolve(w.__documentProviders ?? []);
          }
          if (cmd === "document_providers_bundled") {
            return Promise.resolve(w.__bundledProviders ?? []);
          }
          if (cmd === "document_provider_install_bundled") {
            const found = (w.__bundledProviders ?? []).find((b: any) => b.name === args.name);
            found.installed = true;
            w.__documentProviders = [
              { id: found.manifest.id, manifest: found.manifest, error: null },
            ];
            return Promise.resolve(found.manifest);
          }
          if (cmd === "document_view_url") {
            // Vite serves both sides like the gateway: Cairngorm's relay frame on d-<key> and the
            // provider on v-<key> (*.localhost resolves to loopback).
            const key = "0123456789abcdef0123456789abcdef";
            return Promise.resolve(
              `http://d-${key}.localhost:${location.port}/src/documents/sdk/frame/frame.html?entry=${w.__providerEntry ?? "src/documents/sdk/sample-provider/index.html"}`,
            );
          }
          if (cmd === "document_provider_inspect") {
            return Promise.resolve({
              manifest: w.__providerManifest,
              approvalHash: "reviewed",
              files: 6,
              bytes: 9000,
              replaces: null,
            });
          }
          if (cmd === "document_provider_install") {
            w.__documentProviders = [
              { id: w.__providerManifest.id, manifest: w.__providerManifest, error: null },
            ];
            return Promise.resolve(w.__providerManifest);
          }
          if (cmd === "document_ticket_read") {
            const text = w.__tickets?.[args.ticket];
            return text === undefined
              ? Promise.reject("This agent snapshot is no longer available.")
              : Promise.resolve(new TextEncoder().encode(text).buffer);
          }
          if (cmd === "document_ticket_ack" || cmd === "document_request_complete") {
            return Promise.resolve(null);
          }
          if (cmd === "document_save") {
            const headers = (options as any)?.headers ?? {};
            const path = decodeURIComponent(headers["x-document-path"] ?? "");
            const bytes = args as unknown as Uint8Array;
            const text = new TextDecoder().decode(bytes);
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            w.__saves = [
              ...(w.__saves ?? []),
              { path, version: headers["x-document-version"], text, base64: btoa(binary) },
            ];
            if (w.__saveError) {
              return Promise.reject(w.__saveError);
            }
            w.__documentFiles[path] = text;
            return Promise.resolve("saved-" + w.__saves.length);
          }
          if (cmd === "document_read_snapshot" && w.__binaryFiles?.[args.path]) {
            return Promise.resolve(
              Uint8Array.from(atob(w.__binaryFiles[args.path]), (c) => c.charCodeAt(0)).buffer,
            );
          }
          if (cmd === "document_read_snapshot" && w.__documentFiles?.[args.path]) {
            return Promise.resolve(new TextEncoder().encode(w.__documentFiles[args.path]).buffer);
          }
          if (cmd === "document_read_snapshot") {
            if (w.__docxReadError) {
              return Promise.reject(w.__docxReadError);
            }
            const base64 = String(w.__docxSource).split(",")[1] ?? "";
            return Promise.resolve(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer);
          }
          if (cmd === "fs_read_file_data_url") {
            return w.__docxReadError
              ? Promise.reject(w.__docxReadError)
              : Promise.resolve(w.__docxSource);
          }
          return original(cmd, args);
        };
      },
      { path: DOCX_PATH, src: dataUrl(await docxFixture({ compression: "DEFLATE" })) },
    );
    await app.open();
    await expect(screen.getByTestId("active-project-name")).toHaveText("Documents A");
  });
}
