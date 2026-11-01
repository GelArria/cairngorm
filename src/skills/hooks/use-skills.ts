import { errorMessage } from "@/common/errors";
import { useEffect, useState } from "preact/hooks";
import {
  createSkill,
  listSkillRoots,
  listSkills,
  setSkillEnabled,
  type Skill,
  type SkillRoot,
} from "../data/skills-api";

/** Loads skills each time Settings opens; toggles and creation refresh the list. */
export function useSkills(open: boolean) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [roots, setRoots] = useState<SkillRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, folders] = await Promise.all([listSkills(), listSkillRoots()]);
      setSkills(list);
      setRoots(folders);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open]);

  const setEnabled = async (skill: Skill, enabled: boolean) => {
    setPending(skill.dir);
    setError(null);
    try {
      setSkills(await setSkillEnabled(skill.dir, enabled));
    } catch (e) {
      setError(`${skill.name}: ${errorMessage(e)}`);
    } finally {
      setPending(null);
    }
  };

  /** Resolves with the error message, or null once the skill exists. */
  const create = async (harness: string, name: string, description: string) => {
    try {
      await createSkill(harness, name, description);
      await refresh();
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  return { skills, roots, loading, pending, error, refresh, setEnabled, create };
}
