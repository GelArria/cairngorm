import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const dir =
  process.env.CAIRNGORM_AGENT_DIR ||
  process.env.PANEL_AGENT_DIR ||
  join(homedir(), ".panel", "agent");
const path = join(dir, "config.json");

// Provider selection is explicit: never import personal settings from other apps.
// Dev startup must not overwrite a provider/key saved through Settings › Agent.
if (!existsSync(path) || process.argv.includes("--reset")) {
  mkdirSync(dirname(path), { recursive: true });
  const config = {
    provider: "openai",
    model: "",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
    profiles: {
      "code-assistant":
        "You are a coding assistant. Help write, debug, and refactor code. Use tools to read and write files.",
      "infra-engineer":
        "You are an infrastructure engineer. Help with deployments, configs, and DevOps tasks.",
      "data-analyst":
        "You are a data analyst. Help analyze data, write queries, and create visualizations.",
      "security-auditor":
        "You are a security auditor. Help identify vulnerabilities and review code for security issues.",
      "product-strategist":
        "You are a product strategist. Help with planning, roadmaps, and feature decisions.",
    },
    defaultProfile: "code-assistant",
    toolExecution: "parallel",
    thinkingLevel: "off",
  };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log(`Created unconfigured agent settings: ${path}`);
} else {
  console.log(`Kept existing agent settings: ${path}`);
}
