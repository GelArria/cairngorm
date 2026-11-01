import { getChunkStats } from "../../chunk-timing";
import { fmt, fmtBytes, msColor } from "./format";

// ─── Chunks Tab ──────────────────────────────────────────────────────────────

export function ChunksTab() {
  const stats = getChunkStats();
  if (stats.length === 0) {
    return (
      <div style={{ color: "#888", fontSize: 10 }}>No chunk loads yet (switch to a lazy view)</div>
    );
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
        <span style={{ width: 70 }}>chunk</span>
        <span style={{ width: 28 }}>×n</span>
        <span style={{ width: 44 }}>avg</span>
        <span style={{ width: 44 }}>last</span>
        <span style={{ width: 44 }}>size</span>
      </div>
      {stats.map((s) => (
        <div key={s.name} style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              width: 70,
              color: "#3b82f6",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={s.name}
          >
            {s.name}
          </span>
          <span style={{ width: 28 }}>{s.loads}</span>
          <span style={{ width: 44, color: msColor(s.avgTime) }}>{fmt(s.avgTime)}</span>
          <span style={{ width: 44, color: msColor(s.lastTime) }}>{fmt(s.lastTime)}</span>
          <span style={{ width: 44 }}>{fmtBytes(s.avgSize)}</span>
        </div>
      ))}
    </div>
  );
}
