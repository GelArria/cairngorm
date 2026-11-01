import { skillNameProblem, type SkillRoot } from "@/skills/data/skills-api";
import { useEffect, useState } from "preact/hooks";

export function useNewSkillDialog({
  open,
  roots,
  onCreate,
}: {
  open: boolean;
  roots: SkillRoot[];
  onCancel: () => void;
  /** Resolves with an error to keep the dialog open, or null when created. */
  onCreate: (harness: string, name: string, description: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [harness, setHarness] = useState("agents");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
      setHarness(roots.find((r) => r.exists)?.id ?? "agents");
    }
  }, [open]);
  const nameProblem = name ? skillNameProblem(name) : undefined;
  const submit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    setError(await onCreate(harness, name, description));
    setSaving(false);
  };
  return {
    name,
    setName,
    description,
    setDescription,
    harness,
    setHarness,
    error,
    saving,
    nameProblem,
    submit,
  };
}
