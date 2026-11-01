import { useEffect, useState } from "preact/hooks";
import {
  getBackgroundImageVersion,
  getCachedBackgroundImage,
  loadBackgroundImage,
  subscribeBackgroundImages,
} from "../data/project-backgrounds";

/** Data URL of a (downscaled) background image (null while loading / if unreadable). */
export function useBackgroundImage(path: string | null): string | null {
  const [img, setImg] = useState<string | null>(path ? getCachedBackgroundImage(path) : null);
  const [version, setVersion] = useState(getBackgroundImageVersion());
  useEffect(() => {
    return subscribeBackgroundImages(() => setVersion(getBackgroundImageVersion()));
  }, []);
  useEffect(() => {
    if (!path) {
      setImg(null);
      return;
    }
    const hit = getCachedBackgroundImage(path);
    if (hit) {
      setImg(hit);
      return;
    }
    let alive = true;
    loadBackgroundImage(path)
      .then((url) => {
        if (alive) {
          setImg(url);
        }
      })
      .catch(() => {
        if (alive) {
          setImg(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [path, version]);
  return img;
}
