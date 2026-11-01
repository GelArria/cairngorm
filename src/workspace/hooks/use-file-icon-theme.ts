import { useEffect, useState } from "preact/hooks";
import {
  getFileIconTheme,
  subscribeFileIconTheme,
  type FileIconTheme,
} from "../data/file-icon-theme";

export function useFileIconTheme(): FileIconTheme {
  const [theme, setTheme] = useState(getFileIconTheme);
  useEffect(() => {
    const unsubscribe = subscribeFileIconTheme(setTheme);
    setTheme(getFileIconTheme());
    return unsubscribe;
  }, []);
  return theme;
}
