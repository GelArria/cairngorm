import { getInvokeStats } from "../../invoke-tracker";
import { fmt, msColor } from "./format";

// ─── Invokes Tab ─────────────────────────────────────────────────────────────

export function InvokesTab() {
  const stats = getInvokeStats();
  if (stats.length === 0) {
    return <div style={{ color: "#888", fontSize: 10 }}>No Tauri invoke timings yet</div>;
  }
  return (
    <div style={{ fontSize: 9, lineHeight: 1.6 }}>
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
        <span style={{ width: 80 }}>command</span>
        <span style={{ width: 28 }}>×n</span>
        <span style={{ width: 38 }}>avg</span>
        <span style={{ width: 38 }}>p95</span>
        <span style={{ width: 38 }}>max</span>
        <span style={{ width: 30 }}>err</span>
      </div>
      {stats.map((s) => (
        <div key={s.command} style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              width: 80,
              color: "#a3e635",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={s.command}
          >
            {s.command}
          </span>
          <span style={{ width: 28 }}>{s.calls}</span>
          <span style={{ width: 38, color: msColor(s.avgMs) }}>{fmt(s.avgMs)}</span>
          <span style={{ width: 38, color: msColor(s.p95Ms) }}>{fmt(s.p95Ms)}</span>
          <span style={{ width: 38, color: msColor(s.maxMs) }}>{fmt(s.maxMs)}</span>
          <span style={{ width: 30, color: s.errorRate > 0 ? "#ef4444" : "#555" }}>
            {s.errors > 0 ? `${(s.errorRate * 100).toFixed(0)}%` : "0"}
          </span>
        </div>
      ))}
    </div>
  );
}
