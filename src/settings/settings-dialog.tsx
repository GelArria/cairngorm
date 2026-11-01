import { Dialog } from "@/common/ui/dialog";
import { DocumentSettings } from "@/documents/document-settings";
import { IntegrationSettings } from "@/integrations/integration-settings";
import { McpSettings } from "@/plugins/mcp-settings";
import { PluginSettings } from "@/plugins/plugin-settings";
import { SkillSettings } from "@/skills/skill-settings";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { AppearanceSettings } from "./components/appearance-settings";
import { GeneralSettings } from "./components/general-settings";
import { KeybindingSettings } from "./components/keybinding-settings";
import { SettingsNav } from "./components/settings-nav";
import { TransparencySettings } from "./components/transparency-settings";

export { SPLASH_PREF_KEY } from "./components/general-settings";

const GROUPS = [
  {
    label: "App",
    pages: [
      { id: "general", label: "General", icon: "gear-six" },
      { id: "appearance", label: "Themes & colors", icon: "palette" },
      { id: "transparency", label: "Transparency", icon: "blend" },
      { id: "keybindings", label: "Keybindings", icon: "keyboard" },
      { id: "documents", label: "Documents", icon: "file-text" },
    ],
  },
  {
    label: "Cairngorm agent",
    pages: [{ id: "providers", label: "AI providers", icon: "robot" }],
  },
  {
    // Settings for the agent CLIs run in terminals; the Cairngorm agent ignores them.
    label: "Your CLI agents",
    pages: [
      { id: "skills", label: "Skills", icon: "wand" },
      { id: "mcp", label: "MCP servers", icon: "server" },
      { id: "plugins", label: "Plugins", icon: "plug" },
    ],
  },
] as const;

type PageId = (typeof GROUPS)[number]["pages"][number]["id"];
const PAGE_IDS: readonly string[] = GROUPS.flatMap((g) => g.pages.map((p) => p.id));

function Page({ page, open }: { page: PageId; open: boolean }) {
  switch (page) {
    case "appearance":
      return <AppearanceSettings />;
    case "transparency":
      return <TransparencySettings />;
    case "providers":
      return <IntegrationSettings open={open} />;
    case "skills":
      return <SkillSettings open={open} />;
    case "mcp":
      return <McpSettings open={open} />;
    case "plugins":
      return <PluginSettings open={open} />;
    case "keybindings":
      return <KeybindingSettings />;
    case "documents":
      return <DocumentSettings />;
    default:
      return <GeneralSettings open={open} />;
  }
}

export function SettingsDialog({
  open,
  onClose,
  initialPage,
}: {
  open: boolean;
  onClose: () => void;
  /** Page shown when the dialog opens; the current page is kept otherwise. */
  initialPage?: string;
}) {
  const [page, setPage] = useState<PageId>("general");
  const body = useRef<HTMLDivElement>(null);
  // Layout effect: switch before paint so the previous page never flashes.
  useLayoutEffect(() => {
    if (open && initialPage && PAGE_IDS.includes(initialPage)) {
      setPage(initialPage as PageId);
    }
  }, [open, initialPage]);
  const select = (id: PageId) => {
    setPage(id);
    body.current?.scrollTo({ top: 0 });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Preferences are saved on this machine."
      data-testid="settings-dialog"
      // One size for every page: switching pages never resizes the dialog.
      class="max-w-5xl"
    >
      <div class="flex h-[min(760px,calc(100vh-9rem))] min-h-0 flex-col md:flex-row">
        <SettingsNav groups={GROUPS} active={page} onSelect={select} />
        <div ref={body} data-settings-body="" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Page page={page} open={open} />
        </div>
      </div>
    </Dialog>
  );
}
