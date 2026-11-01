// The Cairngorm logotype (Doop "Brand — Cairngorm logotipo"): the mark beside the
// wordmark (Instrument Sans 600, −3 %).
// No glow or shadow on the name; obsidian or paper grounds only.
import "@fontsource/instrument-sans/600.css";
import { CairngormMark } from "./cairngorm-mark";

interface Props {
  /** wordmark font size in px — the mark and gap scale from it */
  size?: number;
  /** obsidian = app/splash ground, paper = #f2eee8 */
  tone?: "obsidian" | "paper";
  /** soft drop-shadow on the mark (obsidian only) */
  glow?: boolean;
  class?: string;
}

export function CairngormLogo({
  size = 24,
  tone = "obsidian",
  glow = false,
  class: className = "",
}: Props) {
  const paper = tone === "paper";
  // Proportions of the primary lockup: 84 px name ↔ 220 px gem, 34 px gap
  const mark = Math.round(size * 2.6);
  return (
    <div
      role="img"
      aria-label="Cairngorm"
      class={`inline-flex items-center ${className}`}
      style={{ gap: Math.round(size * 0.4) }}
    >
      <CairngormMark
        size={mark}
        tone={tone}
        decorative
        glow={glow && !paper ? Math.max(4, Math.round(size / 5)) : 0}
      />
      <div aria-hidden="true" class="min-w-0">
        <div
          class={`whitespace-nowrap font-brand font-semibold leading-none tracking-[-0.03em] ${paper ? "text-[#171411]" : "text-[#f4ede4]"}`}
          style={{ fontSize: size }}
        >
          Cairngorm
        </div>
      </div>
    </div>
  );
}
