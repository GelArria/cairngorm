import { ContextMenu } from "@/common/components/context-menu";
import { EmptyState } from "@/common/components/empty-state";
import { InlineNotice } from "@/common/components/inline-notice";
import { Button } from "@/common/ui/button";
import { ScrollArea } from "@/common/ui/scroll-area";
import { useWorkspacePanel } from "@/workspace/hooks/use-workspace-panel";
import { FileActionDialogs } from "./components/file-action-dialogs";

import { CairngormLoader } from "@/common/branding/";
import { setProjectRoot } from "@/projects/api";
import { openGlobalSearch } from "@/search";
import { FileTreeItem } from "@/workspace/components/file-tree-item";
import { WorkspaceHeader } from "@/workspace/components/workspace-header";
import { WorkspaceSearch } from "@/workspace/components/workspace-search";

/** File explorer of the ACTIVE project (lives inside the sidebar). */
export function WorkspacePanel() {
  const {
    selectedPath,
    git,
    isAddingFolder,
    setIsAddingFolder,
    isAddingFile,
    setIsAddingFile,
    newName,
    setNewName,
    rootPath,
    loadError,
    loadFsTree,
    showTreeLoader,
    treeBusy,
    fsError,
    setFsError,
    searchMode,
    setSearchMode,
    cm,
    expandCmd,
    projectId,
    handleOpenFolder,
    handleAddKeyDown,
    handleClickFile,
    openSearchMatch,
    fileActions,
    renaming,
    setRenaming,
    commitRename,
    handleMoveNode,
    displayTree,
    sameRoot,
    gitCodes,
    gitCodeOf,
  } = useWorkspacePanel();

  return (
    <div
      class="surface-base flex h-full w-full flex-col bg-card overflow-hidden"
      data-testid="workspace-panel"
      aria-busy={treeBusy}
    >
      <WorkspaceHeader
        rootPath={rootPath}
        branch={sameRoot ? git.branch : null}
        changes={Object.keys(gitCodes).length}
        searchMode={searchMode}
        onOpenFolder={handleOpenFolder}
        onToggleSearch={() => {
          const next = !searchMode;
          setSearchMode(next);
          if (next) {
            openGlobalSearch();
          }
        }}
        onCloseFolder={() => {
          if (projectId) {
            setProjectRoot(projectId, "");
          }
        }}
        onAddFolder={() => {
          setIsAddingFolder(true);
          setIsAddingFile(false);
          setNewName("");
        }}
        onAddFile={() => {
          setIsAddingFile(true);
          setIsAddingFolder(false);
          setNewName("");
        }}
      />

      {loadError && <InlineNotice message={loadError} class="mx-2 mb-1" />}
      {fsError && (
        <InlineNotice message={fsError} class="mx-2 mb-1" onDismiss={() => setFsError(null)} />
      )}
      {searchMode && rootPath ? (
        <WorkspaceSearch onExit={() => setSearchMode(false)} onOpenMatch={openSearchMatch} />
      ) : (
        /* File tree mode */
        <ScrollArea
          class="flex flex-col flex-1 py-1"
          onContextMenu={(e: MouseEvent) => cm.open(e, fileActions.menuFor([], null))}
        >
          {showTreeLoader && <CairngormLoader variant="sidebar" />}
          {!rootPath && (isAddingFolder || isAddingFile) && (
            <input
              class="text-xs h-6 bg-transparent border-b border-foreground w-full mx-2 px-2 outline-none"
              style={{ maxWidth: "calc(100% - 16px)" }}
              placeholder={isAddingFolder ? "Folder name..." : "File name..."}
              value={newName}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              onKeyDown={handleAddKeyDown}
              autoFocus
            />
          )}
          {!treeBusy &&
            displayTree.length === 0 &&
            !isAddingFolder &&
            !isAddingFile &&
            (rootPath ? (
              loadError ? (
                <EmptyState icon="warning-circle" text="Could not load this folder" class="py-16">
                  <Button variant="outline" size="sm" onClick={() => loadFsTree(rootPath)}>
                    Retry
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleOpenFolder}>
                    Choose folder…
                  </Button>
                </EmptyState>
              ) : (
                <EmptyState icon="folder-dashed" text="This folder is empty" class="py-16" />
              )
            ) : (
              <EmptyState icon="folder-open" text="No folder open" class="py-16">
                <Button variant="outline" size="sm" onClick={handleOpenFolder}>
                  Open folder
                </Button>
              </EmptyState>
            ))}
          {!treeBusy &&
            displayTree.map((node) => (
              <FileTreeItem
                key={node.name}
                node={node}
                depth={0}
                path={[node.name]}
                gitCodeOf={gitCodeOf}
                selectedPath={selectedPath}
                expandCmd={expandCmd}
                onContextMenu={(e, path, node) => {
                  setRenaming(null);
                  cm.open(e, fileActions.menuFor(path, node));
                }}
                onClickFile={handleClickFile}
                onMoveNode={handleMoveNode}
                renamingPath={renaming?.path ?? null}
                renamingValue={renaming?.value ?? ""}
                onRenameChange={(v) => setRenaming((r) => (r ? { ...r, value: v } : null))}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenaming(null)}
              />
            ))}
        </ScrollArea>
      )}

      <ContextMenu menu={cm.menu} />
      <FileActionDialogs {...fileActions.dialogs} />
    </div>
  );
}
