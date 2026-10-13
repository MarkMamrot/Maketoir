export interface SidebarNavigationItem {
  id: string;
  children?: readonly SidebarNavigationItem[];
}

export function isSidebarSectionActive(
  item: SidebarNavigationItem,
  activeId: string,
  additionalActiveIds: readonly string[] = [],
): boolean {
  return item.id === activeId
    || Boolean(item.children?.some(child => isSidebarSectionActive(child, activeId)))
    || additionalActiveIds.includes(activeId);
}

export function getCollapsedSidebarAction(item: SidebarNavigationItem): {
  openSection: string | null;
  navigateTo: string | null;
} {
  return item.children?.length
    ? { openSection: item.id, navigateTo: null }
    : { openSection: null, navigateTo: item.id };
}