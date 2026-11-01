import { gitBranches, gitSwitch } from "@/git/data/git-bridge";
import { useEffect, useState } from "preact/hooks";

export function useGitBranchMenu({
  root,
  branch,
  loading,
  refresh,
  onError,
}: {
  root: string | null;
  branch: string | null;
  loading: boolean;
  refresh: () => void;
  onError: (e: string) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState(false);
  useEffect(() => setQuery(""), [root, branch]);
  useEffect(() => {
    let active = true;
    setBranches([]);
    setListing(!!root);
    if (root) {
      void gitBranches(root)
        .then((list) => {
          if (active) {
            setBranches(list);
          }
        })
        .catch((e) => {
          if (active) {
            onError(String(e));
          }
        })
        .finally(() => {
          if (active) {
            setListing(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [root, branch, loading]);
  async function switchTo(name: string, create = false) {
    if (!root || busy || (name === branch && !create)) {
      return;
    }
    setBusy(true);
    onError("");
    try {
      await gitSwitch(root, name, create);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }
  return { branches, busy, creating, setCreating, query, setQuery, listing, switchTo };
}
