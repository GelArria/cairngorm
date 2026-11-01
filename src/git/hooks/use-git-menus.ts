// Right-click menus of the Git panel: a changed file, a commit, the empty area.
import { readFileContent } from "@/common/filesystem/fs-bridge";
import { gitDiscard, gitIgnore, joinPath, revealPath } from "@/common/filesystem/fs-ops";
import { useContextMenu } from "@/common/hooks/use-context-menu";
import { groups } from "@/common/model/context-menu";
import { getExtension } from "@/workspace/model/file-contents";
import { useState } from "preact/hooks";
import {
  gitCommitAction,
  type CommitAction,
  type GitCommit,
  type GitFile,
} from "../data/git-bridge";

interface Deps {
  /** Repo root (porcelain paths are relative to it). */
  repoRoot: string | null;
  root: string | null;
  refresh: () => void | Promise<void>;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
  openDiff: (f: GitFile, staged: boolean) => void;
  onError: (msg: string) => void;
}

const copy = (text: string) => void navigator.clipboard?.writeText(text)?.catch(() => {});

export function useGitMenus(d: Deps) {
  const cm = useContextMenu();
  const [discarding, setDiscarding] = useState<GitFile | null>(null);
  const [commitAction, setCommitAction] = useState<{
    action: CommitAction;
    commit?: GitCommit;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => d.onError(String((e as Error)?.message ?? e));
  const abs = (f: GitFile) => joinPath(d.repoRoot ?? d.root ?? "", f.path);

  const openFile = async (f: GitFile) => {
    try {
      const name = f.path.split("/").pop() ?? f.path;
      const content = await readFileContent(abs(f));
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: name,
            path: [name],
            fullPath: abs(f),
            content,
            extension: getExtension(name),
          },
        }),
      );
    } catch (e) {
      fail(e);
    }
  };
  const act = (fn: () => Promise<unknown>) =>
    void fn()
      .then(() => d.refresh())
      .catch(fail);

  const fileMenu = (e: MouseEvent, f: GitFile, staged: boolean) => {
    const untracked = f.code === "??";
    cm.open(
      e,
      groups(
        [
          { label: "Open Diff", action: () => d.openDiff(f, staged) },
          { label: "Open File", action: () => void openFile(f) },
        ],
        [
          staged
            ? { label: "Unstage Changes", action: () => d.unstage([f.path]) }
            : { label: "Stage Changes", action: () => d.stage([f.path]) },
        ],
        [
          {
            label: untracked ? "Delete File…" : "Discard Changes…",
            danger: true,
            action: () => setDiscarding(f),
          },
        ],
        [
          { label: "Copy Path", action: () => copy(abs(f)) },
          { label: "Copy Relative Path", action: () => copy(f.path) },
          { label: "Reveal in File Explorer", action: () => act(() => revealPath(abs(f))) },
        ],
        [
          untracked && {
            label: "Add to .gitignore",
            action: () => act(() => gitIgnore(d.root ?? "", abs(f), false)),
          },
          untracked && {
            label: "Add to .git/info/exclude",
            action: () => act(() => gitIgnore(d.root ?? "", abs(f), true)),
          },
        ],
      ),
    );
  };

  const commitMenu = (e: MouseEvent, c: GitCommit) =>
    cm.open(
      e,
      groups(
        [
          {
            label: "Cherry-pick…",
            disabled: busy,
            action: () => setCommitAction({ action: "cherry-pick", commit: c }),
          },
          {
            label: "Revert…",
            disabled: busy,
            action: () => setCommitAction({ action: "revert", commit: c }),
          },
        ],
        [
          { label: "Copy Hash", action: () => copy(c.hash) },
          { label: "Copy Subject", action: () => copy(c.subject) },
        ],
      ),
    );

  const panelMenu = (e: MouseEvent) =>
    cm.open(
      e,
      groups(
        [
          { label: "Stage All", action: () => d.stage([]) },
          { label: "Unstage All", action: () => d.unstage([]) },
        ],
        ["cherry-pick", "revert"].flatMap((action) => [
          {
            label: `Continue ${action}`,
            disabled: busy,
            action: () => setCommitAction({ action: `${action}-continue` as CommitAction }),
          },
          {
            label: `Abort ${action}…`,
            disabled: busy,
            danger: true,
            action: () => setCommitAction({ action: `${action}-abort` as CommitAction }),
          },
        ]),
      ),
    );

  const dialogs = {
    history: {
      open: !!commitAction,
      title: "Git history action",
      confirmLabel:
        commitAction?.action === "cherry-pick"
          ? "Cherry-pick"
          : commitAction?.action === "revert"
            ? "Revert"
            : "Confirm",
      message: commitAction?.commit
        ? `${commitAction.action} ${commitAction.commit.hash}: ${commitAction.commit.subject}? This creates a commit on the current branch. A clean working tree is required; conflicts may need manual resolution.`
        : `${commitAction?.action ?? ""}? Continue requires resolved, staged conflicts. Abort discards the in-progress operation.`,
      onCancel: () => setCommitAction(null),
      onConfirm: () => {
        const pending = commitAction;
        setCommitAction(null);
        if (!pending || !d.root || busy) {
          return;
        }
        setBusy(true);
        void gitCommitAction(d.root, pending.action, pending.commit?.hash)
          .catch(fail)
          .finally(() => {
            setBusy(false);
            void d.refresh();
          });
      },
    },
    discard: {
      open: !!discarding,
      title: discarding?.code === "??" ? "Delete file" : "Discard changes",
      message:
        discarding?.code === "??"
          ? `Delete untracked "${discarding?.path}"? This cannot be undone.`
          : `Throw away all changes (staged and unstaged) to "${discarding?.path}"? This cannot be undone.`,
      confirmLabel: discarding?.code === "??" ? "Delete" : "Discard",
      onCancel: () => setDiscarding(null),
      onConfirm: () => {
        const f = discarding;
        setDiscarding(null);
        if (f) {
          act(async () => {
            const r = await gitDiscard(d.root ?? "", f.path, f.code === "??");
            if (r.error) {
              throw new Error(r.error);
            }
          });
        }
      },
    },
  };
  const operation = (action: CommitAction) => setCommitAction({ action });
  return { fileMenu, commitMenu, panelMenu, operation, menu: cm.menu, dialogs };
}
