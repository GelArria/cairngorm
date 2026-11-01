import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Icon } from "@/common/ui/icon";
import { Textarea } from "@/common/ui/textarea";
import { Tooltip } from "@/common/ui/tooltip";
import { IntegrationPicker } from "@/integrations/integration-picker";
import { useGitCommit } from "../hooks/use-git-commit";
import type { useGitStatus } from "../hooks/use-git-status";
import type { GitSyncState } from "../hooks/use-git-sync";
import { COMMIT_MODES, GitCommitButton } from "./git-commit-button";

/** Message, AI draft and one primary action: Commit, or Push once the commits are ready. */
export function GitCommitBox({
  git,
  stagedCount,
  syncState,
  syncBusy,
}: {
  git: ReturnType<typeof useGitStatus>;
  stagedCount: number;
  syncState: GitSyncState;
  syncBusy: boolean;
}) {
  const form = useGitCommit({ git, stagedCount, syncState, syncBusy });
  const {
    message,
    mode,
    setMode,
    busy,
    error,
    setError,
    options,
    setOptions,
    confirmCommit,
    setConfirmCommit,
    generating,
    replaceDraft,
    setReplaceDraft,
    providerPicker,
    box,
    hasChanges,
    summarize,
    canCommit,
    remote,
    showPush,
    requestCommit,
    commit,
    editMessage,
    closeProviderPicker,
    onSummaryReady,
  } = form;
  return (
    <div
      ref={box}
      class="mx-3 flex flex-col rounded-md border border-border focus-within:border-ring/60 [&>div]:shrink-0"
      data-testid="git-commit-box"
    >
      <Textarea
        data-testid="git-commit-message"
        aria-label="Commit message"
        class="min-h-8 max-h-60 resize-y overflow-y-auto border-0 bg-transparent px-2 py-2 text-xs leading-5 focus-visible:ring-0"
        rows={1}
        placeholder="Enter commit message"
        value={message}
        onInput={(e) => {
          editMessage(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            requestCommit();
          }
        }}
      />
      <div class="flex items-center gap-1.5 px-2 pb-2">
        <Tooltip content="AI summary: drafts a message with the selected CLI integration or configured API endpoint (Settings › AI providers). Sends the selected changes; uses that provider's quota or billing. Nothing is committed automatically.">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="AI summarize"
            disabled={busy || syncBusy || !hasChanges}
            onClick={() => (message.trim() ? setReplaceDraft(true) : void summarize())}
          >
            <Icon
              name={generating ? "spinner-gap" : "sparkle"}
              class={`text-[13px] ${generating ? "animate-spin" : ""}`}
            />
          </Button>
        </Tooltip>
        {showPush && remote ? (
          <Button
            size="sm"
            class="flex-1 gap-2"
            data-testid="git-primary-push"
            disabled={busy || syncBusy || git.loading}
            onClick={() =>
              void syncState.sync(remote.upstream ? "push-upstream" : "publish", remote.remote!)
            }
          >
            <Icon name="arrow-down" class="rotate-180" />
            {syncBusy
              ? "Working…"
              : remote.upstream
                ? `Push to ${remote.remote}`
                : `Publish branch to ${remote.remote}`}
          </Button>
        ) : (
          <GitCommitButton
            label={
              busy
                ? "Working…"
                : options.amend
                  ? "Amend Commit"
                  : mode === "staged"
                    ? "Commit"
                    : COMMIT_MODES[mode]
            }
            disabled={!canCommit}
            hasMessage={!!message.trim()}
            busy={busy}
            onCommit={requestCommit}
            mode={mode}
            setMode={setMode}
            options={options}
            setOptions={setOptions}
          />
        )}
      </div>
      {(options.amend || options.signoff || options.skipHooks) && (
        <div class="px-2 pb-1 text-[10px] text-muted-foreground">
          {[
            options.amend && "Amend HEAD",
            options.signoff && "Signoff",
            options.skipHooks && "Skip Hooks",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      <ConfirmDialog
        open={confirmCommit}
        title="Confirm commit options"
        message={`${options.amend ? "Amend replaces the latest commit, including its message; avoid amending shared history. " : ""}${options.skipHooks ? "Skip Hooks bypasses pre-commit and commit-msg validation (--no-verify). " : ""}Continue with the selected changes?`}
        confirmLabel="Commit"
        onCancel={() => setConfirmCommit(false)}
        onConfirm={() => {
          setConfirmCommit(false);
          void commit();
        }}
      />
      <IntegrationPicker
        open={providerPicker}
        onClose={() => {
          closeProviderPicker();
        }}
        onReady={onSummaryReady}
      />
      {error && (
        <InlineNotice message={error} class="mx-1.5 mb-1.5" onDismiss={() => setError(null)} />
      )}
      <ConfirmDialog
        open={replaceDraft}
        title="Replace commit message?"
        message="Generate an AI summary of the selected changes and replace this draft? Changes are sent to the selected CLI integration or configured API endpoint (Settings › AI providers); its quota or billing is used and nothing is committed automatically."
        confirmLabel="Summarize"
        onCancel={() => setReplaceDraft(false)}
        onConfirm={() => void summarize()}
      />
    </div>
  );
}
