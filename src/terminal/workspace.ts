// Workspace operations and subscriptions, without importing terminal renderers.
export { useDetachedWorkspaceEvents } from "./hooks/use-detached-workspace-events";
export {
  attachGroup,
  hideTestsTabs,
  showHiddenTestsTabs,
  detachTab,
  getTerminalTab,
  getTerminalTabs,
  hydrateDetachedGroup,
  openAppTab,
  openAppTabHere,
  openPluginTab,
  openTerminalAt,
  openTestsTab,
  startWorkspacePersistence,
  syncDetachedWorkspace,
  syncProjectGroups,
  useTerminalGroups,
  useTerminalTabs,
} from "./hooks/use-terminal-tabs";
export { startCliAt } from "./data/cli-launch";
export { closeGroup } from "./state/group-actions";
export { saveFileTab } from "./state/file-actions";
export {
  isDocumentWindowReady,
  markDocumentWindowReady,
  reattachDocumentTab,
} from "./state/document-window-actions";
export { setFileDirty } from "./state/file-actions";
