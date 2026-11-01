import { useEffect, useState } from "preact/hooks";
import { subscribeKeybindings } from "../data/keybindings";

export function useKeybindingPreferences() {
  const [, render] = useState(0);
  useEffect(() => {
    const update = () => render((n) => n + 1);
    update();
    return subscribeKeybindings(update);
  }, []);
}
