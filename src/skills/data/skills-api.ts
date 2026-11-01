import { invoke } from "@tauri-apps/api/core";

export interface Skill {
  name: string;
  description: string;
  /** Harness whose skills folder holds the files ("agents", "claude", "codex", …). */
  harness: string;
  harnessName: string;
  /** Other harness folders that link to the same files. */
  linkedFrom: string[];
  dir: string;
  file: string;
  enabled: boolean;
}

export interface SkillRoot {
  id: string;
  name: string;
  path: string;
  exists: boolean;
}

export const listSkills = () => invoke<Skill[]>("skills_list");
export const listSkillRoots = () => invoke<SkillRoot[]>("skills_roots");
/** Disabling renames SKILL.md to SKILL.md.disabled; returns the refreshed list. */
export const setSkillEnabled = (dir: string, enabled: boolean) =>
  invoke<Skill[]>("skills_set_enabled", { dir, enabled });
export const createSkill = (harness: string, name: string, description: string) =>
  invoke<Skill>("skills_create", { harness, name, description });

/** Lowercase letters, digits and inner hyphens: the name every harness accepts. */
export function skillNameProblem(name: string): string | undefined {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    return "Use lowercase letters, digits and hyphens (up to 64 characters)";
  }
  return undefined;
}

/** A query matches name, description or harness; `harness` "all" keeps every folder. */
export function filterSkills(skills: Skill[], query: string, harness: string): Skill[] {
  const needle = query.trim().toLowerCase();
  return skills.filter((skill) => {
    const inHarness =
      harness === "all" || skill.harness === harness || skill.linkedFrom.includes(harness);
    const text = `${skill.name} ${skill.description} ${skill.harnessName}`.toLowerCase();
    return inHarness && (!needle || text.includes(needle));
  });
}
