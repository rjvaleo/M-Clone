import { createContext, useContext } from "react";

const WorkspaceScaleContext = createContext(1);

export const WorkspaceScaleProvider = WorkspaceScaleContext.Provider;

export function useWorkspaceScale(): number {
  return useContext(WorkspaceScaleContext);
}
