import { getComponentStats, getTotalRenders } from "../../render-count";
import { msColor } from "./format";

// ─── Renders Tab ─────────────────────────────────────────────────────────────

export function RendersTab() {
  const stats = getComponentStats().slice(0, 20);
  const total = getTotalRenders();
  if (stats.length === 0) {
    return <div style={{ color: "#888", fontSize: 10 }}>No render data yet</div>;
  }
  return (
    <div style={{ fontSize: 9, lineHeight: 1.5 }}>
      <div style={{ color: "#666", marginBottom: 2 }}>Total renders: {total}</div>
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
        <span style={{ width: 70 }}>component</span>
        <span style={{ width: 28 }}>×n</span>
        <span style={{ width: 28 }}>slow</span>
        <span style={{ width: 36 }}>avg</span>
        <span style={{ width: 36 }}>max</span>
      </div>
      {stats.map((s) => (
        <div key={s.name} style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              width: 70,
              color: "#a855f7",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={s.name}
          >
            {s.name}
          </span>
          <span style={{ width: 28 }}>{s.renders}</span>
          <span style={{ width: 28, color: s.slowRenders > 0 ? "#f97316" : "#555" }}>
            {s.slowRenders}
          </span>
          <span style={{ width: 36, color: msColor(s.avgMs) }}>{s.avgMs.toFixed(1)}ms</span>
          <span style={{ width: 36, color: msColor(s.maxMs) }}>{s.maxMs.toFixed(1)}ms</span>
        </div>
      ))}
    </div>
  );
}
