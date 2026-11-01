import { getWebVitals } from "../../web-vitals";
import { fmt, vitalColor } from "./format";

// ─── Vitals Tab ──────────────────────────────────────────────────────────────

export function VitalsTab() {
  const v = getWebVitals();
  const items = [
    { label: "LCP", value: v.lcp, unit: "ms", good: 2500, poor: 4000 },
    { label: "FID", value: v.fid, unit: "ms", good: 100, poor: 300 },
    { label: "INP", value: v.inp, unit: "ms", good: 200, poor: 500 },
    { label: "CLS", value: v.cls, unit: "", good: 0.1, poor: 0.25 },
    { label: "TTFB", value: v.ttfb, unit: "ms", good: 800, poor: 1800 },
  ];
  return (
    <div style={{ fontSize: 10, lineHeight: 2 }}>
      {items.map((item) => {
        const val = item.value;
        const color = vitalColor(val, item.good, item.poor);
        const display = val === null ? "—" : item.unit === "ms" ? fmt(val) : val.toFixed(3);
        return (
          <div key={item.label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 36, color: "#666" }}>{item.label}</span>
            <span style={{ color, fontWeight: "bold", width: 60 }}>{display}</span>
            <div
              style={{
                flex: 1,
                height: 3,
                background: "#222",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              {val !== null && (
                <div
                  style={{
                    width: `${Math.min((val / item.poor) * 100, 100)}%`,
                    height: "100%",
                    background: color,
                    borderRadius: 2,
                  }}
                />
              )}
            </div>
            <span style={{ fontSize: 8, color: "#444" }}>
              &lt;{item.unit === "ms" ? fmt(item.good) : item.good.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
