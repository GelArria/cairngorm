import { type Skill } from "@/skills/data/skills-api";

export function harnessTabs(skills: Skill[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const skill of skills) {
    const entry = counts.get(skill.harness) ?? { label: skill.harnessName, count: 0 };
    entry.count += 1;
    counts.set(skill.harness, entry);
  }
  return [
    { id: "all", label: "All", count: skills.length },
    ...[...counts].map(([id, { label, count }]) => ({
      id,
      label,
      count,
    })),
  ];
}
