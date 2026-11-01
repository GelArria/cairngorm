import { createContext, type ComponentChildren } from "preact";
import { useContext, useState } from "preact/hooks";

const WorkspaceTabContext = createContext<{
  target: HTMLDivElement | null;
  register: (target: HTMLDivElement | null) => void;
}>({ target: null, register: () => {} });

/** Share the existing tab bar with the dock without moving or remounting terminal panes. */
export function WorkspaceTabProvider({ children }: { children: ComponentChildren }) {
  const [target, register] = useState<HTMLDivElement | null>(null);
  return (
    <WorkspaceTabContext.Provider value={{ target, register }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function WorkspaceTabSlot() {
  const { register } = useContext(WorkspaceTabContext);
  return (
    <div
      ref={register}
      class="flex min-w-0 flex-1 items-center"
      data-testid="dock-workspace-tabs"
    />
  );
}

export function useWorkspaceTabTarget() {
  return useContext(WorkspaceTabContext).target;
}
