import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { RadioGroup, RadioGroupItem } from "@/common/ui/radio-group";

export function ScheduleTimingFields({
  start,
  interval,
  setStart,
  setInterval,
}: {
  start: string;
  interval: string;
  setStart: (value: string) => void;
  setInterval: (value: string) => void;
}) {
  return (
    <fieldset class="space-y-3 border-t border-border pt-3">
      <legend class="px-1 text-xs font-medium">When to run</legend>
      <RadioGroup
        value={interval ? "interval" : "once"}
        onValueChange={(value) => setInterval(value === "interval" ? "60" : "")}
        class="flex gap-2"
        aria-label="Schedule type"
      >
        {[
          ["once", "Once"],
          ["interval", "Every interval"],
        ].map(([value, label]) => (
          <RadioGroupItem
            key={value}
            value={value}
            class="rounded-md border border-border px-3 py-1.5 text-xs data-[state=checked]:bg-accent data-[state=checked]:text-foreground"
          >
            {label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <div>
        <Label for="schedule-start">{interval ? "First run" : "Run at"} (local time)</Label>
        <Input
          id="schedule-start"
          type="datetime-local"
          required
          value={start}
          onInput={(e) => setStart(e.currentTarget.value)}
        />
      </div>
      {interval && (
        <div>
          <Label for="schedule-interval">Repeat every (minutes)</Label>
          <Input
            id="schedule-interval"
            type="number"
            min={1}
            max={525600}
            required
            value={interval}
            onInput={(e) => setInterval(e.currentTarget.value)}
          />
          <div class="mt-2 flex gap-1.5">
            {[
              ["60", "Hourly"],
              ["1440", "Every 24 hours"],
            ].map(([value, label]) => (
              <Button key={value} variant="outline" size="xs" onClick={() => setInterval(value)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p class="text-xs leading-relaxed text-muted-foreground">
        Keep Cairngorm open. Missed runs are combined into one on reopening; tasks run one at a
        time.
      </p>
    </fieldset>
  );
}
