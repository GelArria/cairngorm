import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { Avatar } from "@/common/ui/avatar";
import { gitAuthorAvatarUrl } from "@/git/model/author-avatar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("commit author avatars", () => {
  it("maps GitHub noreply addresses to the matching account", async () => {
    expect(await gitAuthorAvatarUrl(" GelArria@users.noreply.github.com ")).toBe(
      "https://github.com/gelarria.png?size=64",
    );
    expect(await gitAuthorAvatarUrl("12345+gelarria@users.noreply.github.com")).toBe(
      "https://avatars.githubusercontent.com/u/12345?s=64",
    );
  });
  it("hashes normalized emails without sending the raw address", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const url = await gitAuthorAvatarUrl(" User@Example.com ");
    expect(url).toBe(
      "https://www.gravatar.com/avatar/b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514?s=64&d=404",
    );
    expect(await gitAuthorAvatarUrl("user@example.com")).toBe(url);
  });
  it("does not guess an account when identity is missing or invalid", async () => {
    expect(await gitAuthorAvatarUrl()).toBeUndefined();
    expect(await gitAuthorAvatarUrl("not-an-email")).toBeUndefined();
  });
  it("falls back to initials on an image error and retries a different source", () => {
    const view = render(
      <Avatar fallback="G" alt="Avatar of GelArria" src="https://github.com/gelarria.png" />,
    );
    fireEvent.error(view.getByRole("img"));
    expect(view.getByRole("img").textContent).toBe("G");
    expect(view.container.querySelector("img")).toBeNull();
    view.rerender(<Avatar fallback="B" alt="Avatar of Bob" src="https://github.com/bob.png" />);
    expect(view.getByRole("img").getAttribute("src")).toBe("https://github.com/bob.png");
  });
});
