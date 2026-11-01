import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { useCallback, useState } from "preact/hooks";

interface ImageViewerProps {
  src: string;
  alt?: string;
}

export function ImageViewer({ src, alt }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [last, setLast] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(false);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.1, Math.min(10, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      if (zoom <= 1) {
        return;
      }
      setDragging(true);
      setLast({ x: e.clientX, y: e.clientY });
    },
    [zoom],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) {
        return;
      }
      setPan((p) => ({ x: p.x + e.clientX - last.x, y: p.y + e.clientY - last.y }));
      setLast({ x: e.clientX, y: e.clientY });
    },
    [dragging, last],
  );

  const onMouseUp = useCallback(() => setDragging(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setError(false);
  }, []);

  if (error) {
    return (
      <div
        data-testid="image-viewer"
        class="surface-base flex flex-col h-full w-full overflow-hidden bg-background"
      >
        <div class="surface-strip-panel flex items-center gap-2 px-3 py-1 border-b border-border bg-card shrink-0">
          <span class="text-[10px] text-muted-foreground">{alt}</span>
          <Button variant="outline" size="xs" class="ml-auto" onClick={resetView}>
            Retry
          </Button>
        </div>
        <div class="flex flex-1 flex-col items-center justify-center gap-3">
          <Icon name="image-broken" class="text-[30px] text-muted-foreground/60" />
          <span class="text-sm font-medium text-foreground">Failed to load image</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="image-viewer"
      class="surface-base flex flex-col h-full w-full overflow-hidden bg-background"
    >
      <div class="surface-strip-panel flex items-center gap-2 px-3 py-1 border-b border-border bg-card shrink-0">
        <span class="text-[10px] text-muted-foreground truncate max-w-[200px]">{alt}</span>
        <Button
          variant="subtle"
          size="icon-sm"
          class="ml-auto"
          aria-label="Zoom out"
          disabled={zoom <= 0.1}
          onClick={() => setZoom((z) => Math.max(0.1, z - 0.25))}
        >
          <Icon name="minus" class="text-xs" />
        </Button>
        <span class="w-9 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="subtle"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={zoom >= 10}
          onClick={() => setZoom((z) => Math.min(10, z + 0.25))}
        >
          <Icon name="plus" class="text-xs" />
        </Button>
        <Button variant="subtle" size="xs" onClick={resetView}>
          Reset
        </Button>
      </div>
      <div
        class="flex-1 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <img
          src={src}
          alt={alt ?? "Image"}
          class="max-w-full max-h-full object-contain transition-transform"
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
          draggable={false}
          onError={() => setError(true)}
        />
      </div>
    </div>
  );
}
