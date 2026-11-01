import { useSidebarSide } from "@/common/layout/sidebar-side";
import { clearCrashes } from "@/debug/data/crash-store";
import { useEffect, useState } from "preact/hooks";
import { isDebug } from "../debug-mode";
import { downloadPerfReport, resetAllPerfData } from "../export";
import { getAvgFps, getCurrentFps, getFpsPercentile, getMaxFps, getMinFps } from "../fps";
import { startHeavyPerfModules, stopHeavyPerfModules } from "../heavy-init";
import { getTotalRenders } from "../render-count";
import { ChunksTab } from "./overlay/chunks-tab";
import { CrashesTab } from "./overlay/crashes-tab";
import { InvokesTab } from "./overlay/invokes-tab";
import { MemoryTab } from "./overlay/memory-tab";
import { RendersTab } from "./overlay/renders-tab";
import { TabBtn } from "./overlay/tab-button";
import { TimelineTab } from "./overlay/timeline-tab";
import { ViewsTab } from "./overlay/views-tab";
import { VitalsTab } from "./overlay/vitals-tab";

type Tab =
  | "views"
  | "timeline"
  | "invokes"
  | "vitals"
  | "memory"
  | "chunks"
  | "renders"
  | "crashes";

// ─── Main Overlay ───────────────────────────────────────────────────────────

export function PerfOverlay() {
  const [tab, setTab] = useState<Tab>("views");
  const [collapsed, setCollapsed] = useState(true);
  const [, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  // Bottom corner AWAY from the sidebar (never covers its collapse toggle)
  const side = useSidebarSide();
  const corner = {
    ...(side === "right" ? { left: 8 } : { right: 8 }),
    bottom: side === "bottom" ? 76 : 8,
  };

  // Only tick while the expanded overlay is visible.
  useEffect(() => {
    if (!isDebug()) {
      return;
    }
    if (!visible || collapsed) {
      return;
    }
    startHeavyPerfModules();
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(iv);
      stopHeavyPerfModules();
    };
  }, [visible, collapsed]);

  // Visibility detection
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (!isDebug()) {
    return null;
  }

  const fps = getCurrentFps();
  const avg = getAvgFps();
  const renders = getTotalRenders();

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: "fixed",
          ...corner,
          zIndex: 9999,
          background: "rgba(0,0,0,0.85)",
          color: "#a3e635",
          fontFamily: "monospace",
          fontSize: 10,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid rgba(163,230,53,0.3)",
          cursor: "pointer",
        }}
      >
        PERF ▶
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "views", label: "Views" },
    { key: "timeline", label: "Time" },
    { key: "invokes", label: "Tauri" },
    { key: "vitals", label: "Vitals" },
    { key: "memory", label: "Mem" },
    { key: "chunks", label: "Chunks" },
    { key: "renders", label: "Rndr" },
    { key: "crashes", label: "Crash" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        ...corner,
        zIndex: 9999,
        background: "rgba(0,0,0,0.94)",
        color: "#ccc",
        fontFamily: "monospace",
        fontSize: 10,
        padding: 0,
        borderRadius: 6,
        border: "1px solid rgba(163,230,53,0.3)",
        width: 380,
        display: "flex",
        flexDirection: "column",
        maxHeight: 320,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "3px 6px",
          borderBottom: "1px solid #333",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <TabBtn
              key={t.key}
              label={t.label}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: fps < 30 ? "#ef4444" : fps < 55 ? "#f97316" : "#a3e635" }}>
            FPS:{fps.toFixed(0)}
          </span>
          <span style={{ color: "#666", fontSize: 8 }}>avg:{avg.toFixed(0)}</span>
          <button
            onClick={() => {
              resetAllPerfData();
              clearCrashes();
              setTick((t) => t + 1);
            }}
            title="Clear all perf data + crash log"
            style={{
              background: "none",
              border: "1px solid #444",
              color: "#888",
              cursor: "pointer",
              fontSize: 8,
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            CLR
          </button>
          <button
            onClick={() => {
              downloadPerfReport();
            }}
            title="Export perf report as JSON"
            style={{
              background: "none",
              border: "1px solid #444",
              color: "#888",
              cursor: "pointer",
              fontSize: 8,
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            JSON
          </button>
          <button
            onClick={() => setCollapsed(true)}
            style={{
              background: "none",
              border: "none",
              color: "#666",
              cursor: "pointer",
              fontSize: 10,
              padding: 0,
            }}
            title="Minimize"
          >
            ▼
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 6, overflow: "auto", flex: 1 }}>
        {tab === "views" && <ViewsTab />}
        {tab === "timeline" && <TimelineTab />}
        {tab === "invokes" && <InvokesTab />}
        {tab === "vitals" && <VitalsTab />}
        {tab === "memory" && <MemoryTab />}
        {tab === "chunks" && <ChunksTab />}
        {tab === "renders" && <RendersTab />}
        {tab === "crashes" && <CrashesTab />}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "2px 6px",
          borderTop: "1px solid #222",
          color: "#444",
          fontSize: 8,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {renders > 0 && <span>renders: {renders}</span>}
        {renders <= 0 && <span />}
        <span>
          min:{getMinFps().toFixed(0)} p5:{getFpsPercentile(5).toFixed(0)} p95:
          {getFpsPercentile(95).toFixed(0)} max:{getMaxFps().toFixed(0)}
        </span>
      </div>
    </div>
  );
}
