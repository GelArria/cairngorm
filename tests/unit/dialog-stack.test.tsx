import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "preact/hooks";
import { Dialog } from "@/common/ui/dialog";

afterEach(cleanup);

it("Escape closes only the top dialog and then its parent", async () => {
  const parentClosed = vi.fn();
  function Stack() {
    const [child, setChild] = useState(true);
    return (
      <>
        <Dialog open title="Navigation" onClose={parentClosed}>
          <p>Project navigation</p>
        </Dialog>
        <Dialog open={child} title="Schedule event" onClose={() => setChild(false)}>
          <input aria-label="Task name" />
        </Dialog>
      </>
    );
  }
  const view = render(<Stack />);
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Schedule event" })).toBeNull());
  expect(parentClosed).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(parentClosed).toHaveBeenCalledOnce();
});

it("keeps focus inside the top dialog without blocking a menu above it", () => {
  const view = render(
    <>
      <textarea aria-label="Background terminal" />
      <Dialog open title="Close terminal?" onClose={() => {}}>
        <button autoFocus>Cancel</button>
        <button>Confirm</button>
      </Dialog>
    </>,
  );
  const dialog = view.getByRole("dialog");
  dialog.style.zIndex = "60";
  const background = view.getByRole("textbox");
  const cancel = view.getByRole("button", { name: "Cancel", exact: true });
  expect(document.activeElement).toBe(cancel);
  background.focus();
  expect(document.activeElement).toBe(cancel);
  const confirm = view.getByRole("button", { name: "Confirm", exact: true });
  confirm.focus();
  background.focus();
  expect(document.activeElement).toBe(confirm);
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.style.zIndex = "71";
  const item = document.createElement("button");
  menu.append(item);
  document.body.append(menu);
  try {
    item.focus();
    expect(document.activeElement).toBe(item);
  } finally {
    menu.remove();
  }
});

it("a project picker below the dialog does not steal Escape", () => {
  const close = vi.fn();
  const view = render(
    <>
      <div role="menu" style={{ zIndex: 51 }}>
        Project picker
      </div>
      <Dialog open title="Appearance" onClose={close}>
        <p>Background settings</p>
      </Dialog>
    </>,
  );
  view.getByRole("dialog").style.zIndex = "60";
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("a menu above the dialog owns Escape", () => {
  const close = vi.fn();
  render(
    <Dialog open title="Schedule event" onClose={close}>
      <div role="menu">
        <button>Agent choice</button>
      </div>
    </Dialog>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
