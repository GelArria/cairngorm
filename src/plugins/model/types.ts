/** A tool call whose MCP App view the gateway asked Cairngorm to show. */
export interface PluginCall {
  id: string;
  plugin: string;
  pluginName: string;
  pluginLogo?: string;
  /** Terminal session that made the call. */
  terminal: string | null;
  /** Agent CLI that made the call, recognised from its MCP handshake or process. */
  agent?: { id: string; name: string | null } | null;
  /** The server's tool definition (name, inputSchema, _meta). */
  tool: { name: string; title?: string } & Record<string, unknown>;
  arguments: Record<string, unknown>;
  /** Loopback URL serving the view's HTML with its declared CSP. */
  viewUrl: string;
  /** `_meta.ui` of the view resource: declared CSP domains and permissions. */
  view: {
    csp?: Record<string, string[]>;
    permissions?: Record<string, object>;
    prefersBorder?: boolean;
  } | null;
}

export type PluginCallStatus = "running" | "done" | "failed";

export interface PluginCallState {
  call: PluginCall;
  status: PluginCallStatus;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: number;
  recovered?: boolean;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  /** Catalog shelf, e.g. "Productivity". */
  category: string;
  /** The service's own full-colour logo, bundled with the app. */
  logo: string;
  homepage: string;
  terms: string;
  /** "oauth": adding it signs in through the browser; "none": the server is open. */
  auth: "none" | "oauth";
  enabled: boolean;
  /** OAuth plugins only: a sign-in is stored. Added but signed out means "sign in again". */
  signedIn: boolean;
  localApp?: boolean;
  /** A provider shipped with Cairngorm opens this application's files in panes. */
  documentProvider?: string;
  availability?: {
    installed: boolean;
    canEdit: boolean;
    connected: boolean;
    /** How agents drive it: its COM server or its own MCP server; null when they cannot. */
    driver: "com" | "mcp" | null;
    message: string;
  } | null;
}

export interface ClientActivity {
  id: string;
  name: string;
  registration: string | null;
  agent: string | null;
  lastSeen: number;
  synced: boolean;
}

export type ClientFormat = "json" | "typed-json" | "open-code" | "copilot" | "toml";
export interface PluginClient extends AgentRegistration {
  format: ClientFormat;
}

export interface AgentRegistration {
  id: string;
  name: string;
  configPath: string;
  registered: boolean;
  error?: string | null;
  /** Seconds since it last talked to Cairngorm from one of its terminals. */
  lastSeen?: number | null;
  activity?: ClientActivity | null;
  custom?: boolean;
}

export interface PluginsState {
  plugins: PluginInfo[];
  agents: AgentRegistration[];
  clients?: PluginClient[];
  discoveredClients?: ClientActivity[];
  runtime: string | null;
  /** User approved registering the shared bridge with installed agent CLIs. */
  agentsConnected: boolean;
  filesEnabled?: boolean;
  /** "ask" (default): the first use from a terminal asks; "always"; "off". */
  filesAccess?: FileAccess;
  /** Applications agents may script without asking, each in one project. */
  appGrants?: AppGrant[];
  filesAvailable?: boolean;
  wordAvailable?: boolean;
  /** Standard stdio entry for MCP clients not registered automatically. No credentials. */
  bridgeConfig: Record<string, unknown> | null;
  error: string | null;
}

export type FileAccess = "ask" | "always" | "off";

/** "Always allow" for one application (discovery id) in one project. */
export interface AppGrant {
  app: string;
  projectId: string;
}
