// Repo-relative path helpers shared by the server and the UI.

// Drops duplicates and paths inside another listed path ("a" covers "a/b").
export function topLevelPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter(p => !unique.some(q => q !== p && p.startsWith(q + "/")))
}
