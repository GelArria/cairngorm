import { type Appearance } from "@/appearance/model/preferences";
import { useEffect, useState } from "preact/hooks";
import { getAppearance, subscribeAppearance } from "../data/store";

export function useAppearance(): Appearance {
  const [, bump] = useState(0);
  useEffect(() => {
    const un = subscribeAppearance(() => bump((n) => n + 1));
    bump((n) => n + 1);
    return un;
  }, []);
  return getAppearance();
}
