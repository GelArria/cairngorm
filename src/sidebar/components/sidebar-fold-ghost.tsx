// While the sidebar folds, the rail it becomes shows through: the projects' gems in
// the column the collapsed rail draws them in. Decorative only; CSS shows it during a
// fold, so dragging never re-renders the sidebar.
import { useProjects } from "@/projects/index";
import { gemYaw, ProjectGem, projectStone } from "@/projects/visuals";

export function SidebarFoldGhost() {
  const { projects, activeId } = useProjects();
  return (
    <div class="sidebar-fold-ghost" aria-hidden="true">
      {projects.map((p) => {
        const stone = projectStone(p);
        const on = p.id === activeId;
        return (
          <span
            key={p.id}
            class="sidebar-fold-ghost-gem"
            style={
              on ? { borderColor: `${stone.color}88`, background: `${stone.color}1a` } : undefined
            }
          >
            <ProjectGem color={stone.color} cut={p.cut} yaw={gemYaw(p.id)} size={26} />
          </span>
        );
      })}
    </div>
  );
}
