export function fmt(ms: number): string {
  return ms < 0 ? "—" : ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) {
    return `${b}B`;
  }
  if (b < 1048576) {
    return `${(b / 1024).toFixed(0)}KB`;
  }
  return `${(b / 1048576).toFixed(1)}MB`;
}

export function msColor(ms: number): string {
  if (ms < 0) {
    return "#888";
  }
  if (ms < 16) {
    return "#a3e635";
  }
  if (ms < 50) {
    return "#f97316";
  }
  return "#ef4444";
}

export function vitalColor(value: number | null, good: number, poor: number): string {
  if (value === null) {
    return "#888";
  }
  if (value <= good) {
    return "#a3e635";
  }
  if (value <= poor) {
    return "#f97316";
  }
  return "#ef4444";
}

export function fmtAgo(ts: number): string {
  if (!ts) {
    return "—";
  }
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)}h`;
  }
  return `${Math.floor(s / 86400)}d`;
}

export function kindColor(kind: string): string {
  switch (kind) {
    case "render":
      return "#f97316";
    case "async":
      return "#a855f7";
    case "invoke":
      return "#3b82f6";
    case "event":
      return "#eab308";
    case "rust":
      return "#ef4444";
    default:
      return "#888";
  }
}
