import { createContext, useContext, type ReactNode } from "react";
import { useContextMenu, type MenuItem } from "./WindowMenu";

const WindowLauncherContext = createContext<MenuItem[]>([]);

export function mergeWindowLauncherItems(
  local: readonly MenuItem[],
  launcher: readonly MenuItem[],
): MenuItem[] {
  if (local.length === 0) return [...launcher];
  if (launcher.length === 0) return [...local];
  return [...local, "separator", ...launcher];
}

export function WindowLauncherProvider({ items, children }: {
  items: MenuItem[];
  children: ReactNode;
}) {
  return <WindowLauncherContext.Provider value={items}>{children}</WindowLauncherContext.Provider>;
}

export function useWindowContextMenu(local: MenuItem[]) {
  const launcher = useContext(WindowLauncherContext);
  return useContextMenu(mergeWindowLauncherItems(local, launcher));
}
