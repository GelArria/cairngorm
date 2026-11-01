import { Kbd } from "@/common/ui/kbd";
import { KEYBINDINGS, bindingKeys, getBinding } from "@/keybindings/data/keybindings";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";

const GESTURES = [
  ["Mouse side buttons", "Back / forward"],
  ["Esc", "Leave a zoomed pane"],
  ["Double-click", "Zoom / restore a pane"],
  ["Drag a pane", "Swap it with another pane"],
  ["Drag a tab out", "Open it in its own window"],
  ["Middle-click", "Close a tab"],
  ["Enter / Shift+Enter", "Send / new line in Chat UI"],
];

export function HelpPanel() {
  useKeybindingPreferences();
  return (
    <div class="max-h-[70vh] w-[min(400px,85vw)] overflow-y-auto p-1" data-testid="help-panel">
      <div class="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-foreground">Keyboard shortcuts</div>
      <p class="px-2.5 pb-2 text-[11px] text-muted-foreground">
        Customize these in Settings → Keybindings. App shortcuts do not override shell typing.
      </p>
      {[...new Set(KEYBINDINGS.map((d) => d.group))].map((group) => (
        <div key={group} class="mt-1 border-t border-border pt-1">
          <div class="px-2.5 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">{group}</div>
          {KEYBINDINGS.filter((d) => d.group === group).map((def) => {
            const binding = getBinding(def.id);
            return (
              <div
                key={def.id}
                class="flex min-h-7 items-center gap-3 px-2.5 py-1 text-xs text-foreground/90"
              >
                <span class="min-w-0 flex-1">{def.label}</span>
                {binding ? (
                  <Kbd class="shrink-0" keys={bindingKeys(binding)} />
                ) : (
                  <span class="text-[11px] text-muted-foreground">Unassigned</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div class="mt-1 border-t border-border pt-1">
        <div class="px-2.5 pt-1.5 text-[11px] text-muted-foreground">
          Gestures & text input (fixed)
        </div>
        {GESTURES.map(([gesture, label]) => (
          <div key={gesture} class="flex min-h-7 items-center gap-3 px-2.5 py-1 text-xs">
            <span class="flex-1">{label}</span>
            <span class="text-[11px] text-muted-foreground">{gesture}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
