import { cn } from "@/common/utils";
import { useState } from "preact/hooks";

interface AvatarProps {
  fallback: string;
  src?: string;
  alt?: string;
  class?: string;
  colorClass?: string;
}

export function Avatar({ fallback, src, alt, class: className, colorClass }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <div
      class={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
        colorClass ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {src && failedSrc !== src ? (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          class="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span role={alt ? "img" : undefined} aria-label={alt}>
          {fallback}
        </span>
      )}
    </div>
  );
}
