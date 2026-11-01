import { errorMessage } from "@/common/errors";
import { isDocumentTab, saveFileTab } from "../state/file-actions";
import { isImageExtension } from "@/common/filesystem/file-kinds";
import { readFileAsDataURL } from "@/common/filesystem/fs-bridge";
import type { TermTab } from "@/terminal/model/types";
import { useEffect, useState } from "preact/hooks";

export function useFilePane({ tab }: { tab: TermTab }) {
  const extension = (tab.extension ?? "").toLowerCase();
  const isImage = tab.isImage ?? isImageExtension(tab.extension ?? "");
  const isDocument = isDocumentTab(tab);
  const [imgSrc, setImgSrc] = useState<string>(tab.imageSrc ?? "");
  const [markdownEditing, setMarkdownEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab.isDirty) {
      setSaveError(null);
    }
  }, [tab.isDirty]);

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveFileTab(tab.id);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (isImage && !imgSrc && tab.imageSrc) {
      setImgSrc(tab.imageSrc);
    }
  }, [isImage, tab.imageSrc]);

  useEffect(() => {
    if (isImage && !imgSrc && tab.fullPath) {
      let alive = true;
      readFileAsDataURL(tab.fullPath)
        .then((url) => {
          if (alive) {
            setImgSrc(url);
          }
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }
  }, [isImage, imgSrc, tab.fullPath]);

  return {
    extension,
    isImage,
    imgSrc,
    isDocument,
    markdownEditing,
    setMarkdownEditing,
    saving,
    saveError,
    save,
  };
}
