import type { CrashRecord, CrashStat } from "@/debug/data/crash-store";
import { getCrashes, getCrashStats, subscribe } from "@/debug/data/crash-store";
import { useEffect, useState } from "preact/hooks";
import { fmtAgo, kindColor } from "./format";

// ─── Crashes Tab ─────────────────────────────────────────────────────────────

export function CrashesTab() {
  const [, forceUpdate] = useState(0);
  const stats: CrashStat[] = getCrashStats();
  const recent: CrashRecord[] = getCrashes().slice(-30).reverse();

  useEffect(() => {
    const unsub = subscribe(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  if (stats.length === 0) {
    return <div style={{ color: "#888", fontSize: 10 }}>No crashes recorded</div>;
  }

  return (
    <div style={{ fontSize: 9, lineHeight: 1.5 }}>
      {/* Stats table */}
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
        <span style={{ width: 60 }}>module</span>
        <span style={{ width: 24 }}>total</span>
        <span style={{ width: 18 }}>rnd</span>
        <span style={{ width: 18 }}>asyn</span>
        <span style={{ width: 18 }}>invk</span>
        <span style={{ width: 18 }}>evnt</span>
        <span style={{ width: 18 }}>rust</span>
        <span style={{ width: 36 }}>last</span>
      </div>
      {stats.map((s) => (
        <div key={s.module} style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              width: 60,
              color: "#ef4444",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={s.module}
          >
            {s.module}
          </span>
          <span
            style={{
              width: 24,
              color: s.total > 10 ? "#ef4444" : s.total > 3 ? "#f97316" : "#ccc",
            }}
          >
            {s.total}
          </span>
          <span style={{ width: 18, color: s.byKind.render > 0 ? "#f97316" : "#555" }}>
            {s.byKind.render}
          </span>
          <span style={{ width: 18, color: s.byKind.async > 0 ? "#f97316" : "#555" }}>
            {s.byKind.async}
          </span>
          <span style={{ width: 18, color: s.byKind.invoke > 0 ? "#f97316" : "#555" }}>
            {s.byKind.invoke}
          </span>
          <span style={{ width: 18, color: s.byKind.event > 0 ? "#f97316" : "#555" }}>
            {s.byKind.event}
          </span>
          <span style={{ width: 18, color: s.byKind.rust > 0 ? "#ef4444" : "#555" }}>
            {s.byKind.rust}
          </span>
          <span style={{ width: 36, color: "#555" }}>{fmtAgo(s.lastCrash)}</span>
        </div>
      ))}

      {/* Recent crashes */}
      <div style={{ marginTop: 4, borderTop: "1px solid #333", paddingTop: 2 }}>
        <div style={{ color: "#666", marginBottom: 2 }}>Recent ({recent.length})</div>
        {recent.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              gap: 4,
              borderBottom: "1px solid #1a1a1a",
              paddingBottom: 1,
              marginBottom: 1,
            }}
          >
            <span style={{ width: 36, color: "#555" }}>{fmtAgo(c.timestamp)}</span>
            <span
              style={{
                width: 48,
                color: "#ef4444",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.module}
            >
              {c.module}
            </span>
            <span style={{ width: 28, color: kindColor(c.kind) }}>{c.kind}</span>
            <span
              style={{
                color: "#888",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
              title={c.message}
            >
              {c.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
