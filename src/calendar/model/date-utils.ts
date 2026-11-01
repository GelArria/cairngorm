import type { EventFormState } from "./types";

export function today(): { year: number; month: number; day: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function firstDayOfMonth(year: number, month: number): number {
  const jsDay = new Date(year, month, 1).getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Legacy rows may store free text; time inputs require HH:MM. */
export function toTimeInput(t: string): string {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(t.trim());
  if (!m) {
    return t;
  }
  let h = Number(m[1]);
  if (m[3]) {
    h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  }
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

export function emptyForm(date: string): EventFormState {
  return {
    mode: "add",
    date,
    title: "",
    time: "09:00",
    duration: "30",
    color: "bg-blue-500",
    description: "",
  };
}
