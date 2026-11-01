import { laneColor, type GraphRow } from "../model/git-graph";

const ROW = 36,
  CY = 18;
const lx = (lane: number) => 12 + 16 * lane;
export function GraphCell({ row, width, head }: { row: GraphRow; width: number; head: boolean }) {
  const x = lx(row.lane),
    c = laneColor(row.lane);
  return (
    <svg
      width={width}
      height={ROW}
      class="shrink-0"
      aria-hidden="true"
      data-testid="git-graph-cell"
    >
      {row.through.map((l) => (
        <line
          key={`t${l}`}
          x1={lx(l)}
          y1={0}
          x2={lx(l)}
          y2={ROW}
          stroke={laneColor(l)}
          stroke-width="2"
          stroke-opacity=".6"
        />
      ))}
      {row.up && (
        <line x1={x} y1={0} x2={x} y2={CY} stroke={c} stroke-width="2" stroke-opacity=".6" />
      )}
      {row.down && (
        <line x1={x} y1={CY} x2={x} y2={ROW} stroke={c} stroke-width="2" stroke-opacity=".6" />
      )}
      {row.merges.map((l) => (
        <path
          key={`m${l}`}
          d={`M${lx(l)} 0 C${lx(l)} ${CY} ${x} ${CY / 2} ${x} ${CY}`}
          fill="none"
          stroke={laneColor(l)}
          stroke-width="2"
          stroke-opacity=".6"
        />
      ))}
      {row.forks.map((l) => (
        <path
          key={`f${l}`}
          d={`M${x} ${CY} C${x} ${CY + CY / 2} ${lx(l)} ${CY} ${lx(l)} ${ROW}`}
          fill="none"
          stroke={laneColor(l)}
          stroke-width="2"
          stroke-opacity=".6"
        />
      ))}
      {head && <circle cx={x} cy={CY} r={8} fill="none" stroke={c} stroke-opacity=".5" />}
      <circle cx={x} cy={CY} r={4.5} fill={c} stroke="hsl(var(--card))" stroke-width="2" />
    </svg>
  );
}

export function RefChip({ name, lane }: { name: string; lane: number }) {
  const color =
    name.startsWith("tag: ") || (name.includes("/") && !name.startsWith("HEAD"))
      ? undefined
      : laneColor(lane);
  return (
    <span
      data-testid="git-ref-chip"
      title={name.replace("->", "→")}
      class="flex h-[15px] max-w-48 min-w-0 shrink items-center rounded border px-[5px] font-mono text-[9px] leading-none text-muted-foreground"
      style={color ? { color, borderColor: `${color}66`, background: `${color}1a` } : undefined}
    >
      <span class="min-w-0 truncate">{name.replace(/^tag: /, "").replace("->", "→")}</span>
    </span>
  );
}
