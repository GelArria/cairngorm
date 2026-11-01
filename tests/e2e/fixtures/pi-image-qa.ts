import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Native image QA is manual-only: malformed input must never trigger an LLM.
export default function (pi: ExtensionAPI) {
  pi.on("input", () => ({ action: "handled" }));
}
