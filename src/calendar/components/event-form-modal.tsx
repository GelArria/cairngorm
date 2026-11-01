// Add / edit event dialog (shared Dialog: Esc, focus trap, overlay close).
// Order follows the task: what → when → how long → notes → colour.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Textarea } from "@/common/ui/textarea";
import { COLORS } from "../model/constants";
import type { CalendarEvent, EventFormState } from "../model/types";

/** Doop "Dialogs + menus": 32px fields, 13px text, no number spinner. */
const FIELD =
  "h-8 text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function EventFormModal({
  form,
  setForm,
  onDelete,
  onAdd,
  onUpdate,
}: {
  form: EventFormState;
  setForm: (f: EventFormState | null) => void;
  onDelete: (id: string) => void;
  onAdd: (ev: Omit<CalendarEvent, "id">) => void;
  onUpdate: (eventId: string, updates: Partial<Omit<CalendarEvent, "id">>) => void;
}) {
  const set = (patch: Partial<EventFormState>) => setForm({ ...form, ...patch });
  const text = (key: "title" | "time" | "duration" | "date" | "endDate") => ({
    value: form[key] ?? "",
    onInput: (e: Event) => set({ [key]: (e.target as HTMLInputElement).value }),
  });
  const canSave = form.title.trim().length > 0;

  const saveForm = (e?: Event) => {
    e?.preventDefault();
    if (!canSave) {
      return;
    }
    const fields = {
      title: form.title.trim(),
      time: form.time,
      duration: Number(form.duration) || 30,
      date: form.date,
      endDate: form.endDate?.trim() ?? "",
      color: form.color,
      description: form.description?.trim() ?? "",
    };
    if (form.mode === "add") {
      onAdd(fields);
    } else if (form.eventId) {
      onUpdate(form.eventId, fields);
    }
    setForm(null);
  };

  return (
    <Dialog
      open
      onClose={() => setForm(null)}
      title={form.mode === "add" ? "Add event" : "Edit event"}
      description={form.mode === "add" ? "Schedule something on the calendar." : undefined}
      class="max-w-[360px]"
      data-testid="event-form"
    >
      <form class="flex flex-col gap-3 px-5 py-4" onSubmit={saveForm}>
        <div>
          <Label for="ev-title">Title</Label>
          <Input
            id="ev-title"
            class={FIELD}
            placeholder="Event title"
            autoFocus
            {...text("title")}
          />
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <Label for="ev-date">Start date</Label>
            <Input id="ev-date" class={FIELD} type="date" {...text("date")} />
          </div>
          <div>
            <Label for="ev-end">End date</Label>
            <Input id="ev-end" class={FIELD} type="date" min={form.date} {...text("endDate")} />
          </div>
          <div>
            <Label for="ev-time">Time</Label>
            <Input id="ev-time" class={FIELD} type="time" {...text("time")} />
          </div>
          <div>
            <Label for="ev-duration">Duration (min)</Label>
            <Input
              id="ev-duration"
              class={FIELD}
              type="number"
              min={0}
              placeholder="30"
              {...text("duration")}
            />
          </div>
        </div>
        <div>
          <Label for="ev-desc">Description</Label>
          <Textarea
            id="ev-desc"
            value={form.description ?? ""}
            onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })}
            placeholder="Optional notes"
            class="h-16 resize-none text-[13px] leading-[1.45]"
          />
        </div>
        <div role="radiogroup" aria-labelledby="ev-colour">
          <Label id="ev-colour">Colour</Label>
          <div class="flex gap-2">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c.value}
                role="radio"
                aria-checked={form.color === c.value}
                aria-label={c.label}
                title={c.label}
                class={`h-6 w-6 rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${c.value} ${
                  form.color === c.value
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : "opacity-80 hover:opacity-100"
                }`}
                onClick={() => set({ color: c.value })}
              />
            ))}
          </div>
        </div>
        <div class="mt-1 flex items-center gap-2 border-t border-border pt-3.5">
          {form.mode === "edit" && form.eventId && (
            <Button
              variant="outline"
              size="sm"
              class="text-red-400 hover:text-red-300"
              onClick={() => onDelete(form.eventId!)}
            >
              <Icon name="trash" class="mr-1.5 text-xs" />
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" class="ml-auto" onClick={() => setForm(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {form.mode === "add" ? "Add event" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
