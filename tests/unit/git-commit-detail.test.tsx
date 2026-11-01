// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { GitCommitDetail } from "../../src/git/components/git-commit-detail";
import { gitCommitDetails, gitCommitDiff } from "../../src/git/data/git-bridge";

vi.mock("../../src/git/data/git-bridge", () => ({
  gitCommitDetails: vi.fn(),
  gitCommitDiff: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("ignores late diffs after another file is selected and preserves the full commit body", async () => {
  vi.mocked(gitCommitDetails).mockResolvedValue({
    hash: "a".repeat(40),
    author: "Author",
    email: "dev@example.invalid",
    date: "2026-10-05T12:00:00Z",
    refs: [],
    message: "Subject\n\nFull body",
    files: [
      { path: "one.txt", status: "M", added: 1, removed: 1 },
      { path: "two.txt", status: "M", added: 1, removed: 1 },
    ],
  });
  let finishFirst!: (value: string) => void;
  vi.mocked(gitCommitDiff).mockImplementation((_root, _hash, file) =>
    file.path === "one.txt"
      ? new Promise((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve("second file diff"),
  );
  const view = render(
    <GitCommitDetail content={JSON.stringify({ root: "C:/repo", hash: "aaaaaaa" })} />,
  );
  await waitFor(() => expect(gitCommitDiff).toHaveBeenCalledTimes(1));
  fireEvent.click(view.getByText("two.txt"));
  await view.findByText("second file diff");
  finishFirst("stale first file diff");
  await waitFor(() => expect(view.queryByText("stale first file diff")).toBeNull());
  expect(view.getByRole("heading", { name: "Subject" }).textContent).toBe("Subject");
  expect(view.getByTestId("git-commit-body").querySelector("pre")?.textContent).toBe("Full body");
});

it("invalid virtual references fail safely without any backend call", () => {
  const view = render(<GitCommitDetail content="null" />);
  expect(view.getByRole("alert").textContent).toContain("Invalid commit reference");
  expect(gitCommitDetails).not.toHaveBeenCalled();
});
