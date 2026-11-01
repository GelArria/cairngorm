import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import type { useGitMenus } from "../hooks/use-git-menus";

type Props = ReturnType<typeof useGitMenus>["dialogs"];

export function GitActionDialogs({ history, discard }: Props) {
  return (
    <>
      <ConfirmDialog {...history} />
      <ConfirmDialog {...discard} />
    </>
  );
}
