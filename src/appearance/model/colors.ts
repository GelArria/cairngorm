export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function mix(a: string, b: string, amount: number): string {
  const start = rgb(a),
    end = rgb(b);
  return (
    "#" +
    start
      .map((c, i) =>
        Math.round(clamp(c + (end[i] - c) * amount, 0, 255))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function brightness(color: string, value: number): string {
  return mix(color, value >= 100 ? "#ffffff" : "#000000", (Math.abs(value - 100) / 100) * 0.65);
}

/** shadcn/Tailwind tokens use HSL channels so opacity utilities keep working. */
export function hsl(hex: string): string {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  }
  return `${((h * 60 + 360) % 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

export function luminance(hex: string): number {
  const c = rgb(hex).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
