import type { Statement } from "../ast/types.js";
import type { EditHandle } from "../semantic/types.js";

/** Named endpoints move through their owners; never replace these references
 * with absolute coordinates when translating a selection containing the owners. */
export function followingAnchorHandleIds(statements: readonly Statement[], handles: readonly EditHandle[], selectedIds: ReadonlySet<string>): Set<string> {
  const movingNames = new Set<string>();
  const visit = (body: readonly Statement[], inherited = false) => {
    for (const statement of body) {
      const moving = inherited || selectedIds.has(statement.id);
      if (statement.kind === "Scope") visit(statement.body, moving);
      if (statement.kind !== "Path") continue;
      for (const item of statement.items) {
        if (item.kind !== "Node" || !(moving || selectedIds.has(item.id))) continue;
        if (item.name) movingNames.add(item.name);
        for (const alias of item.aliases ?? []) movingNames.add(alias);
      }
    }
  };
  visit(statements);
  const result = new Set<string>();
  for (const handle of handles) {
    if (handle.kind !== "path-point" || handle.coordinateForm !== "named") continue;
    const reference = handle.sourceText.trim().replace(/^\(\s*|\s*\)$/gu, "").trim();
    if ([...movingNames].some((name) => reference === name || reference.startsWith(`${name}.`))) result.add(handle.id);
  }
  return result;
}
