import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/common/ui/radio-group";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { FileAccess } from "../model/types";

const MODES: [FileAccess, string, string][] = [
  ["ask", "Ask first", "The first time an agent in a terminal uses files, Cairngorm asks you."],
  ["always", "Always", "Agents may use files in their terminal's project without asking."],
  ["off", "Off", "Agents get no file tools."],
];

export function FileAccessSettings({
  access,
  available,
  busy,
  open,
  onAccess,
  children,
}: {
  access: FileAccess;
  available: boolean;
  busy: boolean;
  open: boolean;
  onAccess: (access: FileAccess) => void;
  /** Extra rows under the description, such as applications that never ask. */
  children?: ComponentChildren;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!open) {
      setConfirming(false);
    }
  }, [open]);
  const choose = (next: string) => {
    if (next === access || busy) return;
    if (next === "always") setConfirming(true);
    else onAccess(next as FileAccess);
  };
  return (
    <section aria-labelledby="file-access-title" class="space-y-2 border-b border-border pb-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 id="file-access-title" class="text-sm font-medium">
          File access
        </h3>
        <RadioGroup
          value={available ? access : "off"}
          onValueChange={choose}
          aria-label="File access"
          class="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {MODES.map(([value, label]) => (
            <RadioGroupItem
              key={value}
              value={value}
              disabled={busy || (!available && value !== "off")}
              class="rounded-md px-2.5 py-1 text-xs text-muted-foreground disabled:opacity-50 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm"
              data-testid={`file-access-${value}`}
            >
              {label}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">
        {available
          ? access === "off"
            ? MODES[2][2]
            : `Agents can list folders, read text, create documents and open them in panes of their terminal's project. ${MODES.find(([value]) => value === access)?.[2] ?? ""}`
          : "Scoped file tools are currently available on Windows only."}
      </p>
      <p class="text-[11px] text-muted-foreground">
        Files outside the project always need a separate approval, and every save an agent requests
        asks you first. Off also stops agents from controlling installed applications.
      </p>
      {children}
      <Dialog
        open={open && confirming}
        onClose={() => setConfirming(false)}
        title="Always allow project file access"
        class="max-w-md"
      >
        <div class="space-y-3 px-5 py-4 text-xs leading-relaxed">
          <p>
            Connected agents will be able to list folders, read text files, create documents and
            open them in panes of the project belonging to their source terminal, including files
            that may contain secrets, without asking first.
          </p>
          <p>
            Files outside that project need your explicit approval, and every save an agent requests
            needs your approval in that document's pane. This never enables arbitrary file writes or
            desktop automation.
          </p>
        </div>
        <div class="flex justify-end gap-2 px-5 pb-4">
          <Button variant="outline" size="sm" autoFocus onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
              onAccess("always");
            }}
          >
            Always allow
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
