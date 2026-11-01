import { gitAuthorAvatarUrl } from "@/git/model/author-avatar";
import { useEffect, useState } from "preact/hooks";

export function useAuthorAvatar({ email }: { author: string; email?: string }) {
  const [image, setImage] = useState<{ email?: string; src?: string }>({});
  useEffect(() => {
    let active = true;
    void gitAuthorAvatarUrl(email)
      .then((src) => {
        if (active) {
          setImage({ email, src });
        }
      })
      .catch(() => {
        if (active) {
          setImage({ email });
        }
      });
    return () => {
      active = false;
    };
  }, [email]);
  return { image };
}
