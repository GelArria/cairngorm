// Width / height of the terminal area, kept current by the grid so store
// actions can pick a smart arrangement without touching the DOM.
let aspect = 16 / 9;

export function setGridAspect(width: number, height: number) {
  if (width > 0 && height > 0) {
    aspect = width / height;
  }
}

export function gridAspect(): number {
  return aspect;
}
