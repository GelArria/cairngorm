import { expect, it } from "vitest";
import { previewAddress } from "../../src/testing/model/preview-address";

it("accepts local dev-server addresses and HTTPS hosts", () => {
  expect(previewAddress(" localhost:3000/checkout ")).toBe("http://localhost:3000/checkout");
  expect(previewAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
  expect(previewAddress("[::1]:5173")).toBe("http://[::1]:5173/");
  expect(previewAddress("example.com/page")).toBe("https://example.com/page");
  expect(previewAddress("https://example.com/?value=a%20b")).toBe(
    "https://example.com/?value=a%20b",
  );
});

it("rejects privileged schemes, malformed URLs and embedded credentials", () => {
  for (const address of [
    "",
    "not an address",
    "javascript:alert(1)",
    "file:///C:/secret",
    "tauri://localhost",
    "data:text/html,test",
    "https://user:password@example.com",
    "https://example.com/" + "x".repeat(8192),
  ]) {
    expect(() => previewAddress(address), address).toThrow();
  }
});
