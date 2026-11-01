import { cleanup, render } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectLoader } from "../../src/projects/components/project-loader";
import { ProjectGem } from "../../src/projects/components/project-gem";
import { gemYaw } from "../../src/projects/model/project-backgrounds";

vi.mock("../../src/projects/hooks/use-projects", () => ({
  useProjects: () => ({
    activeId: "active",
    projects: [
      { id: "active", background: "preset:ruby", cut: "round" },
      { id: "owner", background: "preset:citrine", color: "iris", cut: "marquise" },
    ],
  }),
}));
vi.mock("../../src/projects/components/project-gem", () => ({
  ProjectGem: vi.fn(() => <svg />),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("uses the owning project's cut and overridden stone color, not the active project", () => {
  const { getByRole } = render(<ProjectLoader projectId="owner" />);
  expect(vi.mocked(ProjectGem).mock.calls[0][0]).toMatchObject({
    color: "#8f95dd",
    cut: "marquise",
    yaw: gemYaw("owner"),
    size: 96,
    spin: true,
  });
  expect(getByRole("status").getAttribute("aria-label")).toBe("Loading terminal");
  expect(getByRole("status").textContent).toBe("");
});

it("defaults to the active project's selected stone when no owner is supplied", () => {
  render(<ProjectLoader />);
  expect(vi.mocked(ProjectGem).mock.calls[0][0]).toMatchObject({
    color: "#ff8a9a",
    cut: "round",
    yaw: gemYaw("active"),
    spin: true,
  });
});
