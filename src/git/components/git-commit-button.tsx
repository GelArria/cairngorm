import { Button } from "@/common/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import type { CommitMode, CommitOptions } from "../data/git-bridge";

export const COMMIT_MODES: Record<CommitMode, string> = {
  staged: "Commit Staged",
  tracked: "Commit Tracked",
  all: "Commit All",
};

const FLAGS = [
  ["amend", "Amend"],
  ["signoff", "Signoff"],
  ["skipHooks", "Skip Hooks"],
] as const;

/** Commit, with what to include and the commit flags behind its caret. */
export function GitCommitButton({
  label,
  disabled,
  hasMessage,
  busy,
  onCommit,
  mode,
  setMode,
  options,
  setOptions,
}: {
  label: string;
  disabled: boolean;
  hasMessage: boolean;
  busy: boolean;
  onCommit: () => void;
  mode: CommitMode;
  setMode: (mode: CommitMode) => void;
  options: CommitOptions;
  setOptions: (update: (v: CommitOptions) => CommitOptions) => void;
}) {
  return (
    <div class="flex min-w-0 flex-1">
      <Button
        size="sm"
        class="min-w-0 flex-1 gap-2 rounded-r-none"
        data-testid="git-commit-btn"
        disabled={disabled}
        onClick={onCommit}
      >
        <Icon name="check" />
        {label}
      </Button>
      <DropdownMenu
        align="end"
        trigger={
          <Button
            size="sm"
            class="w-7 rounded-l-none border-l border-primary-foreground/20 px-0"
            // Dims with an empty message like Commit; stays usable when only the
            // mode blocks Commit (e.g. nothing staged → switch to Commit All).
            disabled={busy || !hasMessage}
            aria-label="Commit options"
          >
            <Icon name="caret-down" />
          </Button>
        }
      >
        <DropdownMenuLabel>Include</DropdownMenuLabel>
        {(Object.keys(COMMIT_MODES) as CommitMode[]).map((value) => (
          <DropdownMenuItem key={value} checked={mode === value} onClick={() => setMode(value)}>
            {COMMIT_MODES[value]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {FLAGS.map(([key, text]) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={options[key]}
            onClick={() => setOptions((v) => ({ ...v, [key]: !v[key] }))}
          >
            {text}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
