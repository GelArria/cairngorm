/** Incremental ANSI/OSC removal. Escape sequences and UTF-8 may span PTY chunks. */
export class TerminalLines {
  private decoder = new TextDecoder();
  private line = "";
  private mode: "text" | "escape" | "csi" | "osc" | "osc-escape" = "text";
  private csi = "";
  private redraw = false;
  private synchronized = false;
  constructor(private emit: (line: string, redraw: boolean) => void) {}

  push(bytes: Uint8Array) {
    this.text(this.decoder.decode(bytes, { stream: true }));
    if (!this.synchronized) {
      this.redraw = false;
    }
  }
  text(text: string) {
    for (const char of text) {
      if (this.mode === "osc") {
        if (char === "\x07") {
          this.mode = "text";
        } else if (char === "\x1b") {
          this.mode = "osc-escape";
        }
        continue;
      }
      if (this.mode === "osc-escape") {
        this.mode = char === "\\" ? "text" : "osc";
        continue;
      }
      if (this.mode === "escape") {
        this.mode = char === "[" ? "csi" : char === "]" ? "osc" : "text";
        this.csi = "";
        continue;
      }
      if (this.mode === "csi") {
        if (char >= "@" && char <= "~") {
          this.mode = "text";
          // Cursor positioning separates rows in full-screen TUI redraws.
          if (char === "H" || char === "f") {
            this.flush();
          }
          if (
            (char === "H" && (!this.csi || this.csi === "1;1")) ||
            (char === "J" && /^[23]$/.test(this.csi))
          ) {
            this.redraw = true;
          }
          if (this.csi === "?2026") {
            this.synchronized = char === "h";
            if (!this.synchronized) {
              this.flush();
              this.redraw = false;
            }
          }
        } else {
          this.csi = (this.csi + char).slice(-32);
        }
        continue;
      }
      if (char === "\x1b") {
        this.mode = "escape";
        continue;
      }
      if (char === "\n" || char === "\r") {
        this.flush();
        continue;
      }
      if (char === "\b") {
        this.line = this.line.slice(0, -1);
        continue;
      }
      if (char >= " " || char === "\t") {
        this.line += char;
      }
      if (this.line.length > 16384) {
        this.flush();
      }
    }
  }
  flush() {
    if (this.line.trim()) {
      this.emit(this.line, this.redraw);
    }
    this.line = "";
  }
}
