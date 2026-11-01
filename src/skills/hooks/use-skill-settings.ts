import { filterSkills, type Skill } from "@/skills/data/skills-api";
import { useSkills } from "@/skills/hooks/use-skills";
import { harnessTabs } from "@/skills/model/skill-tabs";
import { useMemo, useState } from "preact/hooks";

export function useSkillSettings({ open }: { open: boolean }) {
  const { skills, roots, loading, pending, error, refresh, setEnabled, create } = useSkills(open);
  const [query, setQuery] = useState("");
  const [harness, setHarness] = useState("all");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<Skill | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const all = skills ?? [];
  const tabs = useMemo(() => harnessTabs(all), [skills]);
  // A folder tab that disappeared falls back to All.
  const filter = tabs.length > 2 && tabs.some((t) => t.id === harness) ? harness : "all";
  const shown = useMemo(() => filterSkills(all, query, filter), [skills, query, filter]);
  const disabled = all.filter((s) => !s.enabled).length;
  const message = error ?? rowError;
  return {
    skills,
    roots,
    loading,
    pending,
    refresh,
    setEnabled,
    create,
    query,
    setQuery,
    setHarness,
    adding,
    setAdding,
    preview,
    setPreview,
    setRowError,
    all,
    tabs,
    filter,
    shown,
    disabled,
    message,
  };
}
