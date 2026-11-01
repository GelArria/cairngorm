import { gitLog, type GitCommit } from "@/git/data/git-bridge";
import { layoutGraph } from "@/git/model/git-graph";
import { PAGE } from "@/git/model/git-graph-view";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export function useGitGraphView({ content }: { content: string }) {
  const root = useMemo(() => {
    try {
      const value = JSON.parse(content);
      return typeof value.root === "string" ? (value.root as string) : null;
    } catch {
      return null;
    }
  }, [content]);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  // offset pages follow current refs; refresh after history is rewritten.
  const nextOffset = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setLog([]);
    setSelected(null);
    setError(null);
    setBusy(true);
    setMore(false);
    if (root) {
      void gitLog(root, PAGE)
        .then((commits) => {
          if (version !== generation.current) {
            return;
          }
          nextOffset.current = commits.length;
          setLog(commits);
          setSelected(commits[0]?.hash ?? null);
          setMore(commits.length === PAGE);
        })
        .catch((e) => {
          if (version === generation.current) {
            setError(String(e));
          }
        })
        .finally(() => {
          if (version === generation.current) {
            setBusy(false);
          }
        });
    } else {
      setBusy(false);
    }
    return () => {
      generation.current++;
    };
  }, [root, revision]);
  async function loadMore() {
    if (!root || busy) {
      return;
    }
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      const page = await gitLog(root, PAGE, nextOffset.current);
      if (version === generation.current) {
        nextOffset.current += page.length;
        setLog((previous) => {
          const hashes = new Set(previous.map((c) => c.hash));
          return [...previous, ...page.filter((c) => !hashes.has(c.hash))];
        });
        setMore(page.length === PAGE);
      }
    } catch (e) {
      if (version === generation.current) {
        setError(String(e));
      }
    } finally {
      if (version === generation.current) {
        setBusy(false);
      }
    }
  }
  const graph = useMemo(() => layoutGraph(log), [log]);
  const search = query.trim().toLowerCase();
  const matches = log.filter((c) =>
    [c.subject, c.author, c.hash, ...(c.refs ?? [])].some((v) => v.toLowerCase().includes(search)),
  );
  const matchingHashes = new Set(matches.map((c) => c.hash));
  const matchIndex = matches.findIndex((c) => c.hash === selected);
  function navigate(direction: number) {
    if (!matches.length) {
      return;
    }
    const next = matches[(matchIndex + direction + matches.length) % matches.length];
    setSelected(next.hash);
    document.getElementById(`graph-${next.hash}`)?.scrollIntoView({ block: "nearest" });
  }
  const columns = `${graph.width}px minmax(260px,1fr) 90px 120px 72px`;
  return {
    root,
    log,
    selected,
    setSelected,
    error,
    busy,
    more,
    query,
    setQuery,
    setRevision,
    loadMore,
    graph,
    search,
    matches,
    matchingHashes,
    navigate,
    columns,
  };
}
