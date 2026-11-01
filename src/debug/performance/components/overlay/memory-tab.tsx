import {
  getGrowthRateKBps,
  getLeakWarning,
  getMemoryHistory,
  getMemorySnapshot,
} from "../../memory";
import { fmt, fmtBytes } from "./format";

// ─── Memory Tab ──────────────────────────────────────────────────────────────

export function MemoryTab() {
  const mem = getMemorySnapshot();
  const history = getMemoryHistory();
  const growth = getGrowthRateKBps();
  const leak = getLeakWarning();

  if (!mem) {
    return <div style={{ color: "#888", fontSize: 10 }}>Memory API not available</div>;
  }

  const heapPct = mem.jsHeapSizeLimit > 0 ? (mem.usedJsHeapSize / mem.jsHeapSizeLimit) * 100 : 0;

  // Sparkline from history
  const sparkData = history.map((h) => h.usedJsHeapSize / 1048576);
  const sparkMax = Math.max(...sparkData, 1);
  const sparkH = 24;
  const sparkW = 200;
  const sparkPoints = sparkData
    .map((v, i) => {
      const x = (i / (sparkData.length - 1 || 1)) * sparkW;
      const y = sparkH - (v / sparkMax) * sparkH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div style={{ fontSize: 10, lineHeight: 1.8 }}>
      <div>
        <span style={{ color: "#666" }}>JS Heap:</span> {fmtBytes(mem.usedJsHeapSize)} /{" "}
        {fmtBytes(mem.totalJsHeapSize)}
        <div
          style={{
            marginTop: 2,
            height: 4,
            background: "#222",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${heapPct}%`,
              height: "100%",
              background: heapPct > 80 ? "#ef4444" : heapPct > 50 ? "#f97316" : "#a3e635",
            }}
          />
        </div>
      </div>
      <div>
        <span style={{ color: "#666" }}>Rust RSS:</span> {mem.rssMb.toFixed(1)}MB
      </div>
      <div>
        <span style={{ color: "#666" }}>Growth:</span>{" "}
        <span style={{ color: growth > 100 ? "#ef4444" : growth > 30 ? "#f97316" : "#a3e635" }}>
          {growth.toFixed(1)}KB/s
        </span>
        {leak && <span style={{ color: "#ef4444", marginLeft: 4 }}>⚠ LEAK</span>}
      </div>
      <div>
        <span style={{ color: "#666" }}>Uptime:</span> {fmt(mem.uptimeSecs * 1000)}
      </div>
      {sparkData.length > 1 && (
        <div style={{ marginTop: 4 }}>
          <svg width={sparkW} height={sparkH} style={{ display: "block" }}>
            <polyline fill="none" stroke="#a3e635" strokeWidth={1} points={sparkPoints} />
          </svg>
        </div>
      )}
    </div>
  );
}
