import { useAgentSettings } from "@/agent/hooks/use-agent-settings";
// Settings › AI providers (BYOK): provider, model, base URL and API key — tested against
// the provider and saved to ~/.panel/agent/config.json. New agent sessions use it.
import { Button } from "@/common/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { PRESETS } from "./data/agent-config";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div class="flex flex-col gap-1">
      <Label for={htmlFor} class="text-xs text-foreground">
        {label}
      </Label>
      {children}
      {hint && <span class="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function AgentSettings({ open }: { open: boolean }) {
  const {
    saved,
    preset,
    model,
    setModel,
    baseUrl,
    setBaseUrl,
    keyEnv,
    setKeyEnv,
    key,
    setKey,
    removeKey,
    setRemoveKey,
    busy,
    test,
    notice,
    pick,
    dirty,
    keyStatus,
    runTest,
    save,
  } = useAgentSettings({ open });

  return (
    <div class="flex flex-col gap-3" data-testid="agent-settings">
      <Field label="Provider" htmlFor="agent-provider">
        <DropdownMenu
          trigger={
            <Button
              id="agent-provider"
              variant="outline"
              size="sm"
              class="w-full justify-between font-normal"
              data-testid="agent-provider"
            >
              {preset.label}
              <Icon name="caret-down" class="text-xs text-muted-foreground" />
            </Button>
          }
        >
          {PRESETS.map((p) => (
            <DropdownMenuItem
              key={p.id}
              class="min-w-[240px] gap-2 text-xs"
              onClick={() => pick(p)}
            >
              <span class="flex-1">{p.label}</span>
              {p.id === preset.id && <Icon name="check" class="text-xs" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      </Field>
      <Field
        label="Base URL"
        htmlFor="agent-base-url"
        hint={
          preset.id === "custom"
            ? "A compatible cloud, inference host, gateway or local server; usually ending in /v1."
            : undefined
        }
      >
        <Input
          id="agent-base-url"
          class="h-8 font-mono text-xs"
          value={baseUrl}
          placeholder="https://…/v1"
          spellcheck={false}
          onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
        />
      </Field>
      <Field
        label="Model"
        htmlFor="agent-model"
        hint={
          test?.models.length
            ? `${test.models.length} models reported — pick one or enter a supported model ID.`
            : "Use the model ID your endpoint supports. The preset is only a starting point."
        }
      >
        <Input
          id="agent-model"
          class="h-8 font-mono text-xs"
          value={model}
          list="agent-models"
          placeholder="model id"
          spellcheck={false}
          onInput={(e) => setModel((e.target as HTMLInputElement).value)}
        />
        <datalist id="agent-models">
          {test?.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field label="API key" htmlFor="agent-key" hint={keyStatus}>
        <div class="flex gap-1.5">
          <Input
            id="agent-key"
            type="password"
            autoComplete="off"
            class="h-8 font-mono text-xs"
            value={key}
            placeholder={
              saved?.keyHint
                ? `•••• ${saved.keyHint}`
                : preset.keyOptional
                  ? "optional"
                  : "paste your key"
            }
            onInput={(e) => {
              setKey((e.target as HTMLInputElement).value);
              setRemoveKey(false);
            }}
          />
          {saved?.keySource === "saved" && !key && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={removeKey}
              onClick={() => setRemoveKey((v) => !v)}
            >
              {removeKey ? "Keep" : "Remove"}
            </Button>
          )}
        </div>
      </Field>
      <Field
        label="Key environment variable"
        htmlFor="agent-key-env"
        hint="Used when no key is saved here."
      >
        <Input
          id="agent-key-env"
          class="h-8 font-mono text-xs"
          value={keyEnv}
          spellcheck={false}
          onInput={(e) => setKeyEnv((e.target as HTMLInputElement).value.toUpperCase())}
        />
      </Field>
      <div class="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!baseUrl || busy !== null}
          onClick={runTest}
          data-testid="agent-test"
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        <span class="flex-1" />
        <Button
          size="sm"
          disabled={!dirty || busy !== null}
          onClick={save}
          data-testid="agent-save"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
      {(test || notice) && (
        <p
          role="status"
          class={`text-[11px] leading-snug ${(notice ?? test)!.ok ? "text-emerald-400" : "text-red-400"}`}
          data-testid="agent-status"
        >
          {notice?.text ?? test!.message}
        </p>
      )}
    </div>
  );
}
