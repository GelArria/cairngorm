import { Avatar } from "@/common/ui/avatar";
import { useAuthorAvatar } from "@/git/hooks/use-author-avatar";

export function GitAuthorAvatar({ author, email }: { author: string; email?: string }) {
  const { image } = useAuthorAvatar({ author, email });

  return (
    <Avatar
      src={image.email === email ? image.src : undefined}
      alt={`Avatar of ${author}`}
      fallback={author.slice(0, 1).toUpperCase()}
      class="h-5 w-5 text-[9px] ring-1 ring-border/70"
    />
  );
}
