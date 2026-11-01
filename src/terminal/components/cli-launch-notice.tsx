import { Dialog } from "@/common/ui/dialog";
import { Button } from "@/common/ui/button";
import { useEffect, useState } from "preact/hooks";

export function CliLaunchNotice() {
  const [error, setError] = useState("");
  useEffect(() => {
    const receive = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("terminal-launch-failed", receive);
    return () => window.removeEventListener("terminal-launch-failed", receive);
  }, []);
  return (
    <Dialog open={!!error} title="CLI could not start" onClose={() => setError("")}>
      <div class="flex flex-col gap-3 p-4">
        <p role="alert" class="break-words text-xs">
          {error}
        </p>
        <Button size="sm" class="self-end" onClick={() => setError("")}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
