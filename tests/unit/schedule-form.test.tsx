import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleForm } from "@/calendar/components/schedule-form";
import type { ScheduledTaskInput } from "@/calendar/data/scheduled-tasks";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const projects = [{ id: "one", name: "First project", rootPath: "C:/one", createdAt: 1 }];

afterEach(cleanup);
beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
});

function form() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ScheduleForm
      task={null}
      projectId="one"
      projects={projects}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  fireEvent.input(view.getByLabelText("Task name"), { target: { value: "Review changes" } });
  fireEvent.input(view.getByLabelText("Instructions"), {
    target: { value: "Summarize risks. Do not push." },
  });
  return { ...view, onSaved, onClose };
}

describe("schedule activation", () => {
  it("reviews a task and requires explicit consent before saving", async () => {
    const view = form();
    fireEvent.click(view.getByRole("button", { name: "Review schedule" }));
    expect(view.getByRole("dialog", { name: "Review schedule" })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    const activate = view.getByRole("button", { name: "Activate schedule" }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true);
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(activate);
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith("scheduled_tasks_save", {
      input: expect.objectContaining({
        title: "Review changes",
        projectId: "one",
        rootPath: "C:/one",
        agent: "cairngorm",
        intervalMinutes: null,
      }),
    });
    expect(view.onClose).toHaveBeenCalledOnce();
  });

  it("keeps the form and the instructions when native persistence fails", async () => {
    invoke.mockRejectedValueOnce("Disk is full");
    const view = form();
    fireEvent.click(view.getByRole("button", { name: "Review schedule" }));
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(view.getByRole("button", { name: "Activate schedule" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Disk is full"));
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onSaved).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect((view.getByLabelText("Instructions") as HTMLTextAreaElement).value).toBe(
      "Summarize risks. Do not push.",
    );
  });

  it("saves a repeating task in minutes and rejects a past first run", async () => {
    const view = form();
    fireEvent.click(view.getByRole("radio", { name: "Every interval" }));
    fireEvent.input(view.getByLabelText("Repeat every (minutes)"), { target: { value: "15" } });
    fireEvent.input(view.getByLabelText("First run (local time)"), {
      target: { value: "2000-01-01T09:00" },
    });
    fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
    expect(view.getByRole("alert").textContent).toContain("run time is in the past");
    expect(invoke).not.toHaveBeenCalled();
    const future = new Date(Date.now() + 86_400_000);
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    fireEvent.input(view.getByLabelText("First run (local time)"), {
      target: { value: local },
    });
    fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
    await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
    const input = invoke.mock.calls[0][1].input as ScheduledTaskInput;
    expect(input.intervalMinutes).toBe(15);
    expect(input.nextAt).toBe(new Date(local).getTime() / 1000);
  });

  it("names the field that blocks the review", () => {
    const view = form();
    const submit = () => fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
    const alert = () => view.getByRole("alert").textContent;

    fireEvent.input(view.getByLabelText("Task name"), { target: { value: " " } });
    submit();
    expect(alert()).toBe("Enter a task name.");

    fireEvent.input(view.getByLabelText("Task name"), { target: { value: "Review changes" } });
    fireEvent.input(view.getByLabelText("Instructions"), { target: { value: " " } });
    submit();
    expect(alert()).toBe("Enter instructions telling the agent what to do.");

    fireEvent.input(view.getByLabelText("Instructions"), { target: { value: "Summarize." } });
    fireEvent.click(view.getByRole("radio", { name: "Every interval" }));
    fireEvent.input(view.getByLabelText("Repeat every (minutes)"), { target: { value: "0" } });
    submit();
    expect(alert()).toBe("The interval must be at least 1 minute.");

    fireEvent.input(view.getByLabelText("Repeat every (minutes)"), { target: { value: "1.5" } });
    submit();
    expect(alert()).toBe("The interval must be a whole number of minutes.");

    fireEvent.input(view.getByLabelText("Repeat every (minutes)"), { target: { value: "600000" } });
    submit();
    expect(alert()).toContain("cannot exceed 525,600 minutes");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("explains why activation is refused without consent", () => {
    const view = form();
    const submit = () => fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
    submit();
    submit();
    expect(view.getByRole("alert").textContent).toContain("allow the agent to run unattended");
    expect(invoke).not.toHaveBeenCalled();
  });
});
