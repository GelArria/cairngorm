import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { useBrowserStreams } from "@/testing/hooks/use-browser-streams";
import { useTestRun } from "@/testing/hooks/use-test-run";
import { useEffect, useRef, useState } from "preact/hooks";
import { currentBrowserPage } from "../components/test-browser";
import type { ResultStatus } from "../model/types";
import { testPaneMemory } from "../data/test-pane-state";
import { useFrozenBrowser } from "./use-frozen-browser";

export function useTestPaneState(sessionId: string) {
  const run = useTestRun(sessionId);
  const streams = useBrowserStreams(sessionId);
  const hasScreen = streams.length > 0;
  const memory = testPaneMemory(sessionId, run?.id, hasScreen);
  const [view, setView] = useState(memory.view);
  const [selectedPage, setSelectedPage] = useState(memory.selectedPage);
  const [sidebarVisible, setSidebarVisible] = useLocalStorage("test-sidebar-visible", true);
  const previousScreen = useRef(hasScreen);
  useEffect(() => {
    if (previousScreen.current === hasScreen) {
      return;
    }
    previousScreen.current = hasScreen;
    setView((previous) =>
      hasScreen && previous !== "preview" ? "app" : previous === "app" ? "results" : previous,
    );
  }, [hasScreen]);
  const previousRun = useRef(run?.id);
  useEffect(() => {
    if (previousRun.current !== run?.id) {
      setSelectedPage(undefined);
    }
    previousRun.current = run?.id;
  }, [run?.id]);
  const [filter, setFilter] = useState<"all" | ResultStatus>(memory.filter);
  const [query, setQuery] = useState(memory.query);
  const [follow, setFollow] = useState(memory.follow);
  useEffect(() => {
    Object.assign(memory, { view, selectedPage, filter, query, follow });
  }, [view, selectedPage, filter, query, follow, memory]);
  const [now, setNow] = useState(Date.now());
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!follow && view === "output" && outputRef.current) {
      outputRef.current.scrollTop = memory.scrollTop;
    }
  }, [view]);
  useEffect(() => {
    if (run?.status !== "running") {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run?.status, run?.id]);
  useEffect(() => {
    if (follow && view === "output" && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run, follow, view]);
  const stream = currentBrowserPage(streams, selectedPage);
  const {
    displayed,
    paused,
    toggle: togglePause,
    resume,
    error: pauseError,
  } = useFrozenBrowser(stream, run?.id, sessionId);
  const rows =
    run?.results.filter(
      (r) =>
        (filter === "all" || filter === r.status) &&
        r.name.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const selectPage = (id?: string) => {
    setSelectedPage(id);
    resume();
  };
  const toggleFailed = () => setFilter(filter === "failed" ? "all" : "failed");

  return {
    sessionId,
    run,
    streams,
    view,
    setView,
    selectedPage,
    sidebarVisible,
    setSidebarVisible,
    hasScreen,
    filter,
    query,
    follow,
    setFollow,
    now,
    outputRef,
    rememberScroll: () => {
      if (outputRef.current) {
        memory.scrollTop = outputRef.current.scrollTop;
      }
    },
    stream,
    displayed,
    paused,
    togglePause,
    pauseError,
    rows,
    selectPage,
    toggleFailed,
    setQuery,
  };
}
