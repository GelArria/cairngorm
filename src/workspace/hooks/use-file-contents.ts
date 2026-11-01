import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { useCallback } from "preact/hooks";

export function useFileContents() {
  const [contents, setContents] = useLocalStorage<Record<string, string>>("file-contents", {});

  const getContent = useCallback(
    (path: string[]): string => contents[path.join("/")] ?? "",
    [contents],
  );

  const setContent = useCallback(
    (path: string[], value: string) => {
      const key = path.join("/");
      setContents((prev) => ({ ...prev, [key]: value }));
    },
    [setContents],
  );

  const moveContent = useCallback(
    (fromPath: string[], toPath: string[]) => {
      const from = fromPath.join("/"),
        to = toPath.join("/");
      setContents((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(prev)) {
          if (key === from || key.startsWith(from + "/")) {
            next[to + key.slice(from.length)] = value;
            delete next[key];
          }
        }
        return next;
      });
    },
    [setContents],
  );

  return { getContent, setContent, moveContent };
}
