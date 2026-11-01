import { type Transparency } from "@/appearance/model/transparency-preferences";
import { useEffect, useState } from "preact/hooks";
import { getTransparency, subscribeTransparency } from "../data/transparency";

export function useTransparency(): Transparency {
  const [, bump] = useState(0);
  useEffect(() => {
    const un = subscribeTransparency(() => bump((n) => n + 1));
    bump((n) => n + 1);
    return un;
  }, []);
  return getTransparency();
}
