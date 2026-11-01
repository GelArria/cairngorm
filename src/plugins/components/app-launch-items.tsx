// "+" menu: installed applications (Excel, Word…) open inside a pane beside the terminal.
import { DropdownMenuItem, DropdownMenuLabel } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { openAppTabHere } from "@/terminal/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";

interface App {
  id: string;
  name: string;
}

export function AppLaunchItems() {
  const [apps, setApps] = useState<App[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    invoke<App[]>("apps_list")
      .then((list) => live && setApps(list))
      .catch(() => live && setApps([]));
    return () => {
      live = false;
    };
  }, []);
  if (!apps.length) {
    return null;
  }
  // The menu closes on click: the pane opens at once and launches the application itself.
  const open = (app: App) => {
    setError("");
    if (!openAppTabHere({ appId: app.id, appName: app.name, hwnd: "", title: app.name })) {
      setError("Open a terminal in this project first.");
    }
  };
  return (
    <>
      <div class="-mx-1 my-1 h-px bg-border" />
      <DropdownMenuLabel>Applications</DropdownMenuLabel>
      {apps.map((app) => (
        <DropdownMenuItem
          key={app.id}
          class="gap-2 font-sans text-xs"
          onClick={() => open(app)}
          data-testid={`app-launch-${app.id}`}
        >
          <Icon name="layout" class="text-sm text-muted-foreground" />
          <span>{app.name}</span>
        </DropdownMenuItem>
      ))}
      {error && (
        <p role="alert" class="max-w-64 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
