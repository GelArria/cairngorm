import { getRecords } from "../../timing";
import { fmt, msColor } from "./format";

// ─── Timeline Tab ───────────────────────────────────────────────────────────

export function TimelineTab() {
  const records = getRecords().slice(0, 25);
  if (records.length === 0) {
    return <div style={{ color: "#888", fontSize: 10 }}>No transitions yet</div>;
  }
  return (
    <div style={{ fontSize: 9, lineHeight: 1.5 }}>
      {records.map((r, i) => {
        const total = Math.max(r.clickToEffect + r.effectToPaint, 0.01);
        const clickPct = r.clickToEffect > 0 ? (r.clickToEffect / total) * 100 : 0;
        const paintPct = r.effectToPaint > 0 ? (r.effectToPaint / total) * 100 : 0;
        return (
          <div
            key={i}
            style={{ borderBottom: "1px solid #1a1a1a", paddingBottom: 2, marginBottom: 1 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  color: "#666",
                  width: 50,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.from}
              </span>
              <span style={{ color: "#555" }}>→</span>
              <span
                style={{
                  color: "#a3e635",
                  width: 60,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.to}
              </span>
              <span style={{ color: msColor(r.totalTime), fontWeight: "bold" }}>
                {fmt(r.totalTime)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 2, marginTop: 1, height: 3 }}>
              {clickPct > 0 && (
                <div
                  style={{ width: `${clickPct}%`, background: "#3b82f6", borderRadius: 1 }}
                  title={`click→effect: ${fmt(r.clickToEffect)}`}
                />
              )}
              {paintPct > 0 && (
                <div
                  style={{ width: `${paintPct}%`, background: "#a855f7", borderRadius: 1 }}
                  title={`effect→paint: ${fmt(r.effectToPaint)}`}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 6, color: "#555", marginTop: 1 }}>
              <span>click={fmt(r.clickToEffect)}</span>
              <span>paint={fmt(r.effectToPaint)}</span>
              {r.chunkLoadTime !== null && (
                <span style={{ color: "#3b82f6" }}>chunk={fmt(r.chunkLoadTime)}</span>
              )}
              {r.longTasks > 0 && <span style={{ color: "#f97316" }}>LT:{r.longTasks}</span>}
              {r.layoutShifts > 0 && <span style={{ color: "#ef4444" }}>CLS:{r.layoutShifts}</span>}
              {r.memBefore !== null &&
                r.memAfter !== null &&
                (() => {
                  const d = r.memAfter! - r.memBefore!;
                  return (
                    <span style={{ color: d > 0 ? "#f97316" : "#a3e635" }}>
                      mem:{d >= 0 ? "+" : ""}
                      {(d / 1024).toFixed(0)}KB
                    </span>
                  );
                })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
