export interface UpdateCheck {
  state: "disabled" | "current" | "available";
  current: string;
  repo: string;
  branch: string;
  version?: string | null;
  notes?: string | null;
  page?: string | null;
  installable: boolean;
  /** A verified installer is already downloaded and waits for the app to exit. */
  ready: boolean;
}

export type Step = "idle" | "downloading" | "ready";

export const releasePage = (page?: string | null) =>
  page && page.startsWith("https://github.com/") ? page : null;
