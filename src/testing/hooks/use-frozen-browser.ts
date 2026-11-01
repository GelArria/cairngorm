import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserStream } from "../data/browser-store";
import { testPaneMemory } from "../data/test-pane-state";

export function useFrozenBrowser(
  stream: BrowserStream | undefined,
  runId?: string | number,
  sessionId?: string,
) {
  const memory = sessionId ? testPaneMemory(sessionId, runId) : undefined;
  const [frozen, setFrozen] = useState<BrowserStream | undefined>(memory?.frozen);
  const [error, setError] = useState<string | undefined>(memory?.pauseError);
  const previousRun = useRef(runId);
  useEffect(() => {
    if (memory) {
      memory.frozen = frozen;
      memory.pauseError = error;
    }
  }, [frozen, error, memory]);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    if (previousRun.current !== runId) {
      setFrozen(undefined);
      setError(undefined);
    }
    previousRun.current = runId;
    return () => {
      generation.current++;
    };
  }, [runId]);
  const paused = !!frozen;
  const resume = () => {
    generation.current++;
    setFrozen(undefined);
    setError(undefined);
  };
  const toggle = async () => {
    if (paused) {
      resume();
      return;
    }
    if (!stream) {
      return;
    }
    const version = ++generation.current;
    try {
      // Native page IDs point at the newest JPEG; pin a copy to truly freeze it.
      const imageId = stream.imageId
        ? await invoke<string>("test_browser_freeze", { imageId: stream.imageId })
        : undefined;
      if (version === generation.current) {
        setFrozen({ ...stream, imageId });
        setError(undefined);
      }
    } catch (err) {
      if (version === generation.current) {
        setError(String(err));
      }
    }
  };
  return { displayed: paused ? frozen : stream, paused, toggle, resume, error };
}
