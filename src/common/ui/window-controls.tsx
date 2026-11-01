import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type WindowPlatform = "windows" | "macos" | "linux" | "other";

export function detectWindowPlatform(value: string): WindowPlatform {
  const ua = value.toLowerCase();
  if (ua.includes("windows") || ua.includes("win32")) {
    return "windows";
  }
  if (ua.includes("macintosh") || ua.includes("mac os") || ua.includes("macintel")) {
    return "macos";
  }
  if (ua.includes("linux") || ua.includes("x11")) {
    return "linux";
  }
  return "other";
}

export function getWindowPlatform(): WindowPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }
  return detectWindowPlatform(`${navigator.userAgent} ${navigator.platform}`);
}

const run =
  (action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) => async () => {
    try {
      await action(getCurrentWindow());
    } catch {
      /* unavailable outside Tauri */
    }
  };

const minimize = run((window) => window.minimize());
const maximize = run((window) => window.toggleMaximize());
const close = run((window) => window.close());

function Control({
  label,
  icon,
  class: className,
  onClick,
}: {
  label: string;
  icon: "minus" | "square" | "x" | "plus";
  class?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <Button
        variant="subtle"
        size="icon"
        class={className}
        data-tauri-no-drag-region
        aria-label={label}
        onClick={onClick}
      >
        <Icon name={icon} class="text-[13px]" />
      </Button>
    </Tooltip>
  );
}

function TrafficLight({
  label,
  color,
  icon,
  onClick,
}: {
  label: string;
  color: string;
  icon: "x" | "minus" | "plus";
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <Button
        variant="subtle"
        size="icon"
        class={`group h-3 w-3 rounded-full p-0 ${color}`}
        data-tauri-no-drag-region
        aria-label={label}
        onClick={onClick}
      >
        <Icon name={icon} class="h-2 w-2 text-black/70 opacity-0 group-hover:opacity-100" />
      </Button>
    </Tooltip>
  );
}

export function WindowControls({ platform = getWindowPlatform() }: { platform?: WindowPlatform }) {
  if (platform === "macos") {
    return (
      <div class="flex h-full items-center gap-2 px-2" data-window-controls="macos">
        <TrafficLight
          label="Close"
          color="bg-[#ff5f57] hover:bg-[#ff453a]"
          icon="x"
          onClick={close}
        />
        <TrafficLight
          label="Minimize"
          color="bg-[#febc2e] hover:bg-[#ffb000]"
          icon="minus"
          onClick={minimize}
        />
        <TrafficLight
          label="Maximize"
          color="bg-[#28c840] hover:bg-[#18b832]"
          icon="plus"
          onClick={maximize}
        />
      </div>
    );
  }

  return (
    <div class="flex h-full items-center" data-window-controls={platform}>
      <Control
        label="Minimize"
        icon="minus"
        class="h-[38px] w-[46px] rounded-none"
        onClick={minimize}
      />
      <Control
        label="Maximize"
        icon="square"
        class="h-[38px] w-[46px] rounded-none"
        onClick={maximize}
      />
      <Control
        label="Close"
        icon="x"
        class="h-[38px] w-[46px] rounded-none hover:bg-red-600 hover:text-white"
        onClick={close}
      />
    </div>
  );
}
