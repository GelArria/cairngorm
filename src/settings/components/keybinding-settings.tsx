import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Kbd } from "@/common/ui/kbd";
import {
  KEYBINDINGS,
  KEYBINDING_CONTEXTS,
  bindingFromEvent,
  bindingKeys,
  getBinding,
  isBindingCustomized,
  resetBindings,
  setBinding,
  type KeybindingId,
} from "@/keybindings/data/keybindings";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";
import { useLayoutEffect, useState } from "preact/hooks";
import { SettingsPage } from "./settings-layout";

export function KeybindingSettings() {
  useKeybindingPreferences();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<KeybindingId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edit = (id: KeybindingId | null) => {
    setEditing(id);
    setError(null);
  };
  useLayoutEffect(() => {
    if (!editing) {
      return;
    }
    const capture = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) {
        return;
      }
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setEditing(null);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        edit(null);
        return;
      }
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) {
        return;
      }
      const key = bindingFromEvent(e);
      if (!key) {
        setError(
          "Use Ctrl / Alt plus a key, or a function key. Clipboard, undo and OS shortcuts are reserved.",
        );
        return;
      }
      const problem = setBinding(editing, key);
      setError(problem);
      if (!problem) {
        setEditing(null);
      }
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [editing]);

  const filtered = KEYBINDINGS.filter((d) =>
    `${d.label} ${d.group} ${getBinding(d.id) ?? "disabled"}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const groups = [...new Set(filtered.map((d) => d.group))];
  const customized = KEYBINDINGS.filter((d) => isBindingCustomized(d.id)).length;

  return (
    <div data-testid="keybindings-settings" data-keybinding-capture={editing ? "true" : undefined}>
      <SettingsPage
        title="Keybindings"
        description="Click a shortcut to record a new combination. Esc cancels; Tab leaves recording. Ctrl also accepts ⌘ on macOS. Clipboard and undo are reserved; shell control keys and editor commands take priority."
        actions={
          <Button
            variant="outline"
            size="xs"
            disabled={!customized}
            onClick={() => {
              edit(null);
              setError(resetBindings());
            }}
          >
            Restore all defaults
          </Button>
        }
      >
        <div class="flex flex-col gap-2">
          <Input
            type="search"
            aria-label="Search keybindings"
            placeholder="Search actions or shortcuts…"
            value={query}
            onFocus={() => edit(null)}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              edit(null);
            }}
          />
          <p class="text-[11px] text-muted-foreground" role="status">
            {filtered.length} actions · {customized} customized
          </p>
        </div>
        {error && (
          <p
            role="alert"
            class="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        {groups.length === 0 && (
          <p class="py-8 text-center text-xs text-muted-foreground">
            No keybindings match your search.
          </p>
        )}
        {groups.map((group) => (
          <section key={group} aria-label={group}>
            <h4 class="mb-2 text-[13px] font-semibold text-foreground">{group}</h4>
            <div class="overflow-hidden rounded-md border border-border">
              {filtered
                .filter((d) => d.group === group)
                .map((def) => {
                  const binding = getBinding(def.id);
                  const recording = editing === def.id;
                  const custom = isBindingCustomized(def.id);
                  return (
                    <div
                      key={def.id}
                      class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-3 last:border-b-0"
                      data-testid={`keybinding-${def.id}`}
                    >
                      <div class="min-w-40 flex-1">
                        <div class="text-xs font-medium text-foreground">
                          {def.label}
                          {custom && (
                            <span class="ml-2 text-[11px] font-normal text-muted-foreground">
                              Modified
                            </span>
                          )}
                        </div>
                        <div class="mt-1 text-[11px] text-muted-foreground">
                          When: {KEYBINDING_CONTEXTS[def.context]}
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          class={recording ? "border-ring bg-accent" : ""}
                          aria-label={`Edit ${def.label} shortcut`}
                          aria-pressed={recording}
                          onClick={() => edit(recording ? null : def.id)}
                        >
                          {recording ? (
                            "Press keys…"
                          ) : binding ? (
                            <Kbd keys={bindingKeys(binding)} />
                          ) : (
                            <span class="text-muted-foreground">Unassigned</span>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={!binding}
                          aria-label={`Disable ${def.label} shortcut`}
                          onClick={() => {
                            edit(null);
                            setError(setBinding(def.id, null));
                          }}
                        >
                          Disable
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={!custom}
                          aria-label={`Restore ${def.label} shortcut`}
                          onClick={() => {
                            edit(null);
                            setError(setBinding(def.id, undefined));
                          }}
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </SettingsPage>
    </div>
  );
}
