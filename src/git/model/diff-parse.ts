// Pure parser for the diff tabs the Git panel opens: an optional commit header
// ("● author <email> · hash · age" + subject) followed by `git diff` output.
export interface DiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
  old?: number;
  new?: number;
  word?: [number, number];
}
export interface DiffHunk {
  header: string;
  oldStart: number;
  oldEnd: number;
  lines: DiffLine[];
}
export interface ParsedDiff {
  author?: string;
  hash?: string;
  age?: string;
  subject?: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  raw?: string;
}

export function splitDiffLines(lines: DiffLine[]): { before?: DiffLine; after?: DiffLine }[] {
  const rows: { before?: DiffLine; after?: DiffLine }[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind === "ctx") {
      rows.push({ before: lines[i], after: lines[i] });
      i++;
      continue;
    }
    const before: DiffLine[] = [],
      after: DiffLine[] = [];
    while (i < lines.length && lines[i].kind !== "ctx") {
      const line = lines[i++];
      (line.kind === "del" ? before : after).push(line);
    }
    for (let k = 0; k < Math.max(before.length, after.length); k++) {
      rows.push({ before: before[k], after: after[k] });
    }
  }
  return rows;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Changed span [start, end) of `a` vs `b` (common prefix/suffix trimmed). */
function changedSpan(a: string, b: string): [number, number] | undefined {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  return p === 0 && s === 0 ? undefined : [p, a.length - s];
}

export function parseDiff(content: string): ParsedDiff {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const out: ParsedDiff = { hunks: [], added: 0, removed: 0 };
  let i = 0;
  if (lines[0]?.startsWith("● ")) {
    const m = /^● (.*?) · (\S+) · (.+)$/.exec(lines[0]);
    if (m) {
      out.author = m[1];
      out.hash = m[2];
      out.age = m[3];
    }
    out.subject = lines[1] ?? "";
    i = 2;
  }
  let hunk: DiffHunk | null = null;
  let o = 0,
    n = 0;
  const bodyStart = i;
  for (; i < lines.length; i++) {
    const l = lines[i];
    // a new file section ends the previous hunk (its ---/+++ are not lines)
    if (l.startsWith("diff --git")) {
      hunk = null;
      continue;
    }
    const h = HUNK.exec(l);
    if (h) {
      o = +h[1];
      n = +h[3];
      hunk = {
        header: l,
        oldStart: o,
        oldEnd: o + (h[2] === undefined ? 1 : +h[2]) - 1,
        lines: [],
      };
      out.hunks.push(hunk);
      continue;
    }
    if (!hunk || l.startsWith("\\")) {
      continue;
    }
    if (l.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: l.slice(1), new: n++ });
      out.added++;
    } else if (l.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: l.slice(1), old: o++ });
      out.removed++;
    } else if (l.startsWith(" ") || l === "") {
      hunk.lines.push({ kind: "ctx", text: l.slice(1), old: o++, new: n++ });
    }
  }
  // Word-level highlight for 1:1 del→add pairs
  for (const hk of out.hunks) {
    for (let k = 0; k < hk.lines.length - 1; k++) {
      const a = hk.lines[k],
        b = hk.lines[k + 1];
      const prev = hk.lines[k - 1],
        next = hk.lines[k + 2];
      if (a.kind === "del" && b.kind === "add" && prev?.kind !== "del" && next?.kind !== "add") {
        a.word = changedSpan(a.text, b.text);
        b.word = changedSpan(b.text, a.text);
      }
    }
  }
  if (out.hunks.length === 0) {
    out.raw = lines.slice(bodyStart).join("\n").trim();
  }
  return out;
}
