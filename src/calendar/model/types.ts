export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  duration: number;
  date: string;
  endDate?: string;
  color: string;
  description?: string;
}

export interface EventFormState {
  mode: "add" | "edit";
  date: string;
  endDate?: string;
  eventId?: string;
  title: string;
  time: string;
  duration: string;
  color: string;
  description?: string;
}
