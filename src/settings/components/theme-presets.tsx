import { selectTheme } from "@/appearance/data/store";
import { useAppearance } from "@/appearance/hooks/use-appearance";
import { THEME_PRESETS } from "@/appearance/model/presets";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { useState } from "preact/hooks";

export function ThemePresets() {
  const p = useAppearance();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const themes = THEME_PRESETS.filter(
    (t) =>
      (filter === "all" || t.mode === filter) &&
      t.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section class="min-w-0" aria-label="Theme presets">
      <h4 class="text-[13px] font-semibold">
        Theme library{" "}
        <span class="ml-1 font-normal text-muted-foreground">{THEME_PRESETS.length} presets</span>
      </h4>
      <p class="mt-1 text-[11px] text-muted-foreground">
        Applying a preset resets your color and visibility adjustments.
      </p>
      <Input
        class="my-3 h-8 text-xs"
        aria-label="Search themes"
        placeholder="Search themes…"
        value={search}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      <div role="group" aria-label="Filter themes" class="mb-3 flex gap-1">
        {[
          ["all", "All"],
          ["light", "Light"],
          ["dark", "Dark"],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant="subtle"
            size="xs"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
        <span class="ml-auto self-center text-[11px] text-muted-foreground">
          {themes.length} themes
        </span>
      </div>
      <div
        class="grid max-h-[360px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
        aria-label="Available themes"
      >
        {themes.map((t) => (
          <Button
            key={t.id}
            variant="outline"
            class="h-auto min-w-0 flex-col items-stretch gap-0 overflow-hidden p-0 text-left font-normal"
            aria-label={t.name}
            aria-pressed={p.preset === t.id && p.mode === "preset"}
            data-testid={`theme-${t.id}`}
            onClick={() => selectTheme(t.id)}
          >
            <div
              class="flex h-14 items-center gap-1.5 p-2"
              style={{ background: t.background, color: t.foreground }}
              aria-hidden="true"
            >
              <div
                class="h-full w-4 rounded-sm"
                style={{ background: t.card, border: `1px solid ${t.border}` }}
              />
              <div class="flex flex-1 flex-col gap-1.5">
                <div class="h-1 w-4/5 rounded-sm" style={{ background: t.foreground }} />
                <div class="h-1 w-3/5 rounded-sm" style={{ background: t.muted }} />
                <div class="h-1 w-full" style={{ background: t.border }} />
              </div>
              <div class="h-3 w-3 rounded-full" style={{ background: t.accent }} />
            </div>
            <div class="flex min-w-0 items-center gap-1 px-2 py-1.5">
              <span class="flex-1 truncate text-[11px]">{t.name}</span>
              {p.preset === t.id && p.mode === "preset" && (
                <Icon name="check" class="text-primary" />
              )}
            </div>
          </Button>
        ))}
      </div>
      {themes.length === 0 && (
        <p class="py-6 text-center text-xs text-muted-foreground">No themes match your search.</p>
      )}
    </section>
  );
}
