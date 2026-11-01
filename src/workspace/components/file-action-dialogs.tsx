import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { PromptDialog } from "@/common/ui/prompt-dialog";
import type { FileActionDialogProps } from "../model/file-action-types";

export function FileActionDialogs({
  creating,
  deleting,
  setCreating,
  setDeleting,
  validateName,
  createItem,
  deleteItem,
}: FileActionDialogProps) {
  return (
    <>
      <PromptDialog
        open={!!creating}
        title={creating?.kind === "folder" ? "New Folder" : "New File"}
        label={`Name${creating?.dir.length ? ` (in ${creating.dir.join("/")})` : ""}`}
        placeholder={creating?.kind === "folder" ? "folder-name" : "file-name.ext"}
        confirmLabel="Create"
        validate={validateName}
        onCancel={() => setCreating(null)}
        onSubmit={createItem}
      />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.node.type === "folder" ? "folder" : "file"}`}
        message={`Delete "${deleting?.node.name ?? ""}"${deleting?.node.type === "folder" ? " and everything in it" : ""}? This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={deleteItem}
      />
    </>
  );
}
