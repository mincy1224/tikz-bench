import type { Statement } from "../ast/types.js";
import type { SemanticDependencyGraph } from "../semantic/dependencies.js";
import type { EditHandle } from "../semantic/types.js";

/** Named endpoints move through their owners; never replace these references
 * with absolute coordinates when translating a selection containing the owners. */
export function followingAnchorHandleIds(statements: readonly Statement[], handles: readonly EditHandle[], selectedIds: ReadonlySet<string>, dependencies?: SemanticDependencyGraph): Set<string> {
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
  if (dependencies) {
    const nodes = new Map(dependencies.nodes.map((node) => [node.id, node]));
    for (const edge of dependencies.edges) {
      const owner = nodes.get(edge.from), resource = nodes.get(edge.to);
      if (edge.relation === "producer" && owner?.kind === "source" && selectedIds.has(owner.sourceId) && resource?.kind === "resource") movingNames.add(resource.resourceKey);
    }
  }
  const result = new Set<string>();
  for (const handle of handles) {
    if (handle.kind !== "path-point" || handle.coordinateForm !== "named") continue;
    const reference = handle.sourceText.trim().replace(/^\(\s*|\s*\)$/gu, "").trim();
    let follows = movingNames.has(reference);
    for (let dot = reference.indexOf("."); !follows && dot >= 0; dot = reference.indexOf(".", dot + 1)) follows = movingNames.has(reference.slice(0, dot));
    if (follows) result.add(handle.id);
  }
  return result;
}
