import { errorMessage } from "@/common/errors";
import { readFileContent } from "@/common/filesystem/fs-bridge";
import { type Skill } from "@/skills/data/skills-api";
import { useEffect, useState } from "preact/hooks";

export function useSkillPreview({ skill }: { skill: Skill | null; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (skill) {
      readFileContent(skill.file)
        .then(setText)
        .catch((e) => setText(`Could not read this file: ${errorMessage(e)}`));
    }
  }, [skill?.file]);
  return { text };
}
