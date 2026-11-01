/** Called only after ViewHost authenticates the iframe's origin and window. */
export function forwardViewContextMenu(frame: HTMLIFrameElement, params: Record<string, unknown>) {
  const { x, y } = params;
  const rect = frame.getBoundingClientRect();
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > rect.width ||
    y > rect.height
  ) {
    return;
  }
  // Return keyboard input to the host so Escape and menu navigation work.
  frame.blur();
  frame.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}
