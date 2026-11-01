import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { gitSummarize, type CommitMode, type CommitOptions } from "../data/git-bridge";
import type { useGitStatus } from "./use-git-status";
import type { GitSyncState } from "./use-git-sync";

interface GitCommitOptions {
  git: ReturnType<typeof useGitStatus>;
  stagedCount: number;
  /** Push/pull state, owned by the panel (its header pulls, its menu pushes). */
  syncState: GitSyncState;
  syncBusy: boolean;
}
/** Own draft revisions, provider setup and commit settlement for one repository. */
export function useGitCommit({ git, stagedCount, syncState, syncBusy }: GitCommitOptions) {
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CommitMode>("staged");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<CommitOptions>({
    amend: false,
    signoff: false,
    skipHooks: false,
  });
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState(false);
  const [providerPicker, setProviderPicker] = useState(false);
  const pendingSummary = useRef<{ revision: number; root: string; mode: CommitMode } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    revision.current++;
    setOptions({ amend: false, signoff: false, skipHooks: false });
    setConfirmCommit(false);
  }, [git.branch]);
  const resize = () => {
    const input = box.current?.querySelector("textarea");
    if (!input) {
      return;
    }
    input.style.height = "0px";
    input.style.height = `${Math.min(120, Math.max(32, input.scrollHeight))}px`;
  };
  useLayoutEffect(resize, [message]);
  useEffect(() => {
    if (!box.current) {
      return;
    }
    let width = -1;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width;
      if (nextWidth === width) {
        return;
      } // Height changes from autosizing must not retrigger it.
      width = nextWidth;
      cancelAnimationFrame(frame);
      if (width > 0) {
        frame = requestAnimationFrame(resize);
      }
    });
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const hasChanges =
    mode === "staged" ? stagedCount > 0 : git.files.some((f) => mode === "all" || f.code !== "??");
  async function summarize() {
    if (!git.root || busy || !hasChanges) {
      return;
    }
    const version = revision.current;
    setReplaceDraft(false);
    setBusy(true);
    setGenerating(true);
    setError(null);
    try {
      if (await invoke<boolean>("ai_summary_setup_required")) {
        if (active.current && version === revision.current) {
          pendingSummary.current = { revision: version, root: git.root, mode };
          setProviderPicker(true);
        }
        return;
      }
      const summary = await gitSummarize(git.root, mode);
      if (active.current && version === revision.current) {
        setMessage(summary);
      }
    } catch (err) {
      if (active.current) {
        setError(String(err));
      }
    } finally {
      if (active.current) {
        setBusy(false);
        setGenerating(false);
      }
    }
  }
  const canCommit =
    !!message.trim() &&
    !busy &&
    !syncBusy &&
    !git.loading &&
    (hasChanges || (options.amend && git.log.length > 0));
  const remote = syncState.status;
  const showPush = !hasChanges && !options.amend && !!remote?.remote && remote.ahead > 0;
  const requestCommit = () => {
    if (canCommit) {
      options.amend || options.skipHooks ? setConfirmCommit(true) : void commit();
    }
  };
  async function commit() {
    if (!canCommit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = await git.commit(message, mode, options);
      if (err) {
        setError(err);
      } else {
        setMessage("");
        setOptions({ amend: false, signoff: false, skipHooks: false });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const editMessage = (value: string) => {
    revision.current++;
    setMessage(value);
  };
  const closeProviderPicker = () => {
    pendingSummary.current = null;
    setProviderPicker(false);
  };
  const onSummaryReady = () => {
    setProviderPicker(false);
    const pending = pendingSummary.current;
    pendingSummary.current = null;
    if (
      active.current &&
      pending?.revision === revision.current &&
      pending.root === git.root &&
      pending.mode === mode
    ) {
      void summarize();
    } else if (active.current) {
      setError(
        "The draft or selected changes changed during setup. Click AI summary again to generate a new draft.",
      );
    }
  };
  return {
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
    syncState,
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
  };
}
