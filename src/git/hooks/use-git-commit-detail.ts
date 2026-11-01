import {
  gitCommitDetails,
  gitCommitDiff,
  type GitCommitDetails,
  type GitCommitFile,
} from "@/git/data/git-bridge";
import { useEffect, useMemo, useState } from "preact/hooks";

export function useGitCommitDetail({
  content,
  inspector = false,
}: {
  content: string;
  inspector?: boolean;
}) {
  const request = useMemo(() => {
    try {
      const value = JSON.parse(content);
      return typeof value.root === "string" && typeof value.hash === "string"
        ? (value as { root: string; hash: string; file?: string })
        : null;
    } catch {
      return null;
    }
  }, [content]);
  const [detail, setDetail] = useState<GitCommitDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<GitCommitFile | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffRetry, setDiffRetry] = useState(0);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [tree, setTree] = useState(true);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    setSelected(null);
    if (request) {
      void gitCommitDetails(request.root, request.hash)
        .then((value) => {
          if (!active) {
            return;
          }
          setDetail(value);
          setSelected(value.files.find((f) => f.path === request.file) ?? value.files[0] ?? null);
        })
        .catch((e) => {
          if (active) {
            setError(String(e));
          }
        });
    }
    return () => {
      active = false;
    };
  }, [request, retry]);
  useEffect(() => {
    let active = true;
    setPatch(null);
    setDiffError(null);
    if (!inspector && request && detail && selected) {
      void gitCommitDiff(request.root, detail.hash, selected)
        .then((value) => {
          if (active) {
            setPatch(value);
          }
        })
        .catch((e) => {
          if (active) {
            setDiffError(String(e));
          }
        });
    }
    return () => {
      active = false;
    };
  }, [request, detail, selected, diffRetry, inspector]);
  return {
    request,
    detail,
    error,
    setRetry,
    selected,
    setSelected,
    patch,
    diffError,
    setDiffRetry,
    copyError,
    setCopyError,
    tree,
    setTree,
  };
}
