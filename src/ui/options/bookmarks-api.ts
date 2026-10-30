/** Thin wrappers over the optional `bookmarks` permission and `chrome.bookmarks.getTree`. */
import { buildFolderTree, type FolderNode } from "./bookmarks-tree";

const PERM: chrome.permissions.Permissions = { permissions: ["bookmarks"] };

export const hasBookmarksPermission = (): Promise<boolean> => chrome.permissions.contains(PERM);

/** Must be called synchronously from a click handler (it needs the user gesture). */
export const requestBookmarksPermission = (): Promise<boolean> => chrome.permissions.request(PERM);

export const removeBookmarksPermission = (): Promise<boolean> => chrome.permissions.remove(PERM);

/** False until the permission is granted (the API object is then missing). */
export const bookmarksApiAvailable = (): boolean =>
  typeof chrome.bookmarks !== "undefined" && typeof chrome.bookmarks.getTree === "function";

export async function loadFolders(): Promise<FolderNode[]> {
  return buildFolderTree(await chrome.bookmarks.getTree());
}
