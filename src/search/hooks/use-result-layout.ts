import type { SearchMatch } from "@/common/filesystem/fs-bridge";
import { useMemo } from "preact/hooks";
import { layout } from "../model/result-layout";

export function useResultLayout(results: SearchMatch[], expandedFiles: Record<string, boolean>) {
  return useMemo(() => layout(results, expandedFiles), [results, expandedFiles]);
}
