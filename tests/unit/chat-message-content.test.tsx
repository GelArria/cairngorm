import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { ChatMessageContent } from "../../src/terminal/components/chat-message-content";

describe("ChatMessageContent", () => {
  it("renders fences as code boxes with the language label", () => {
    const { container } = render(
      <ChatMessageContent text={"before\n\n```ts\nconst a = 1;\n```\n\nafter"} />,
    );
    expect(container.querySelectorAll("pre code").length).toBe(1);
    expect(container.querySelector("pre code")?.textContent).toBe("const a = 1;");
    expect(container.textContent).toContain("ts"); // shown uppercase via CSS
    // the blank lines around the fence are not duplicated as text
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("styles inline code and bold, leaves the rest as text", () => {
    const { container } = render(<ChatMessageContent text={"use `foo()` and **bar** here"} />);
    expect(container.querySelector("code")?.textContent).toBe("foo()");
    expect(container.querySelector("strong")?.textContent).toBe("bar");
  });

  it("renders an unclosed fence (mid-stream) instead of dropping it", () => {
    const { container } = render(<ChatMessageContent text={"```py\nprint(1)"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("print(1)");
  });
});

describe("ChatMessageContent — safety", () => {
  it("never turns markup into elements", () => {
    const { container } = render(
      <ChatMessageContent text={"<script>alert(1)</script> <b>x</b>"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("does not style a segment that merely starts and ends with a backtick", () => {
    const { container } = render(<ChatMessageContent text={"`a\nb`"} />);
    expect(container.querySelectorAll("code").length).toBe(0);
  });
});
