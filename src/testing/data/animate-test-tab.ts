/** Capture the requesting pane before focus/layout changes, then fly its test tab into the bar. */
export function animateTestTab(sourceId: string, targetId: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const find = (attribute: string, id: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (el) => el.getAttribute(attribute) === id && el.getBoundingClientRect().width > 0,
    );
  const source = find("data-pane-id", sourceId) ?? find("data-tab-id", sourceId);
  if (!source) {
    return;
  }
  const origin = source.getBoundingClientRect();
  requestAnimationFrame(() => {
    const target = find("data-tab-id", targetId);
    if (!target || !target.animate) {
      return;
    }
    const destination = target.getBoundingClientRect();
    const ghost = target.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-tab-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.dataset.testTabFlight = sourceId;
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${destination.left}px`,
      top: `${destination.top}px`,
      width: `${destination.width}px`,
      height: `${destination.height}px`,
      margin: "0",
      zIndex: "100",
      pointerEvents: "none",
    });
    document.body.append(ghost);
    const dx = origin.left + origin.width / 2 - destination.left - destination.width / 2;
    const dy = origin.top + Math.min(64, origin.height / 2) - destination.top;
    const options = { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" };
    target.animate([{ opacity: 0 }, { opacity: 0, offset: 0.75 }, { opacity: 1 }], options);
    const flight = ghost.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(.85)`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy - 12}px) scale(.95)`, opacity: 1, offset: 0.2 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      options,
    );
    flight.finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  });
}
