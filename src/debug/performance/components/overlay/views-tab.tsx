import { getViewTimings } from "../../timing";
import { fmt, fmtBytes, msColor } from "./format";

// ─── Views Tab ──────────────────────────────────────────────────────────────

export function ViewsTab() {
  const timings = getViewTimings();
  if (timings.length === 0) {
    return <div style={{ color: "#888", fontSize: 10 }}>Switch views to measure</div>;
  }
  return (
    <div style={{ fontSize: 10, lineHeight: 1.6 }}>
      <div
        style={{
          color: "#666",
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #333",
          paddingBottom: 2,
          marginBottom: 2,
        }}
      >
        <span style={{ width: 60 }}>view</span>
        <span style={{ width: 44 }}>1st</span>
        <span style={{ width: 44 }}>last</span>
        <span style={{ width: 44 }}>avg</span>
        <span style={{ width: 30 }}>×n</span>
        <span style={{ width: 44 }}>memΔ</span>
        <span style={{ width: 36 }}>LT</span>
      </div>
      {timings.map((t) => (
        <div key={t.view} style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              width: 60,
              color: "#a3e635",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t.view}
          </span>
          <span style={{ width: 44, color: msColor(t.firstVisit) }}>{fmt(t.firstVisit)}</span>
          <span style={{ width: 44, color: msColor(t.lastVisit) }}>{fmt(t.lastVisit)}</span>
          <span style={{ width: 44, color: msColor(t.totalTime / t.visits) }}>
            {fmt(t.totalTime / t.visits)}
          </span>
          <span style={{ width: 30 }}>×{t.visits}</span>
          <span style={{ width: 44, color: t.avgMemDelta > 102400 ? "#f97316" : "#888" }}>
            {fmtBytes(Math.abs(t.avgMemDelta))}
            {t.avgMemDelta >= 0 ? "+" : "-"}
          </span>
          <span style={{ width: 36, color: t.longTasks > 0 ? "#f97316" : "#555" }}>
            {t.longTasks}LT
          </span>
        </div>
      ))}
    </div>
  );
}
