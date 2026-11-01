import { CairngormLoader } from "@/common/branding/";
import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { MONTHS } from "../model/constants";

export function EventCalendarHeader({
  compact,
  month,
  year,
  current,
  loading,
  error,
  onPrevious,
  onNext,
  onToday,
  onAdd,
  onClearError,
}: {
  compact: boolean;
  month: number;
  year: number;
  current: boolean;
  loading: boolean;
  error: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
  onClearError: () => void;
}) {
  return (
    <div
      class={`flex shrink-0 flex-wrap items-center gap-1.5 px-2 pb-3 pt-3.5 ${compact ? "" : "sm:px-4"}`}
    >
      <Button variant="ghost" size="icon-sm" onClick={onPrevious} aria-label="Previous month">
        <Icon name="caret-left" class="text-sm" />
      </Button>
      <h2
        class={`min-w-0 flex-1 text-center font-semibold tracking-[-0.01em] ${compact ? "text-sm" : "text-base sm:flex-none sm:min-w-[150px] sm:text-lg"}`}
      >
        {MONTHS[month]} {year}
      </h2>
      <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next month">
        <Icon name="caret-right" class="text-sm" />
      </Button>
      <Button
        variant="outline"
        size="xs"
        class="ml-1.5"
        onClick={onToday}
        disabled={current}
        aria-label="Today"
      >
        Today
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="New event" onClick={onAdd}>
        <Icon name="plus" />
      </Button>
      {loading && <CairngormLoader variant="inline" label="Loading events…" class="ml-3" />}
      {error && (
        <InlineNotice
          message={error}
          class="w-full sm:ml-auto sm:w-auto sm:max-w-[60%]"
          onDismiss={onClearError}
        />
      )}
    </div>
  );
}
