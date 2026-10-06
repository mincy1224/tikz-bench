import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index";
import { followingAnchorHandleIds } from "../packages/core/src/edit/anchored-selection";
import { applyEditAction } from "../packages/core/src/edit/actions";
import { computeDragCapability } from "../packages/app/src/ui/canvas-panel/drag-capability";
import { evaluateSemantic } from "./semantic/helpers";
import { pt, worldPoint } from "../packages/core/src/coords/index";
import { readFileSync } from "node:fs";

const source = String.raw`\begin{tikzpicture}
\node[draw,rectangle split,rectangle split parts=2] (record13) at (0,0) {A\nodepart{two} B};
\node[draw] (record17) at (3,1) {C};
\node[draw] (record16) at (3,-1) {D};
\draw[->] (record13.east) -- (record17.west);
\draw[->] (record13.east) -- (record16.west);
\end{tikzpicture}`;

describe("moving nodes together with their anchored connectors", () => {
  it("moves the user's left-hand diagram including its arrows and three scopes", () => {
    const input = readFileSync(new URL("./fixtures/anchored-left-diagram.tex", import.meta.url), "utf8");
    const selected = parseTikz(input).figure.body.filter((statement) => {
      const text = input.slice(statement.span.from, statement.span.to);
      return /record(?:12|13|14|15|16|17)\b/u.test(text) || statement.kind === "Scope" && /xshift=(?:-47|71)pt/u.test(text);
    });
    const ids = selected.map((statement) => statement.id);
    expect(ids).toHaveLength(11);
    const result = applyEditAction(input, evaluateSemantic(input).editHandles, { kind: "moveElements", elementIds: ids, delta: worldPoint(pt(20), pt(10)) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("(record13.east) -- (record17.west)");
    expect(result.newSource).toContain("(record13.east) -- (record16.west)");
    const before = evaluateSemantic(input);
    const after = evaluateSemantic(result.newSource);
    for (const handle of before.editHandles.filter((handle) => selected.some((statement) => statement.span.from <= handle.sourceRef.sourceSpan.from && statement.span.to >= handle.sourceRef.sourceSpan.to))) {
      const moved = after.editHandles.find((candidate) => candidate.id === handle.id)!;
      expect(Math.abs(moved.world.x - handle.world.x - 20)).toBeLessThan(0.15);
      expect(Math.abs(moved.world.y - handle.world.y - 10)).toBeLessThan(0.15);
    }
    const right = parseTikz(input).figure.body.find((statement) => input.slice(statement.span.from, statement.span.to).includes("(record18)"))!;
    expect(result.newSource).toContain(input.slice(right.span.from, right.span.to));
  });
  it("accepts the entire selection and preserves both arrow references", () => {
    const semantic = evaluateSemantic(source);
    const ids = new Set(["path:0", "path:1", "path:2", "path:3", "path:4"]);
    const following = followingAnchorHandleIds(parseTikz(source).figure.body, semantic.editHandles, ids);
    const capability = computeDragCapability(semantic.editHandles);
    expect(semantic.editHandles.filter((handle) => ids.has(handle.sourceRef.sourceId)).every((handle) => capability.draggableHandleIds.has(handle.id) && handle.rewriteMode !== "unsupported" || following.has(handle.id))).toBe(true);
    const result = applyEditAction(source, semantic.editHandles, { kind: "moveElements", elementIds: [...ids], delta: worldPoint(pt(20), pt(10)) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("(record13.east) -- (record17.west)");
    expect(result.newSource).toContain("(record13.east) -- (record16.west)");
    const next = evaluateSemantic(result.newSource);
    for (const before of semantic.editHandles) {
      const after = next.editHandles.find((handle) => handle.id === before.id)!;
      // The existing coordinate writer rounds centimetres to two decimals.
      expect(Math.abs(after.world.x - before.world.x - 20)).toBeLessThan(0.15);
      expect(Math.abs(after.world.y - before.world.y - 10)).toBeLessThan(0.15);
    }
  });

  it("does not declare an endpoint movable when its owner is outside the selection", () => {
    const handles = evaluateSemantic(source).editHandles;
    const following = followingAnchorHandleIds(parseTikz(source).figure.body, handles, new Set(["path:0", "path:3"]));
    const ends = handles.filter((handle) => handle.sourceRef.sourceId === "path:3");
    expect(ends.filter((handle) => following.has(handle.id))).toHaveLength(1);
    expect(ends.every((handle) => following.has(handle.id))).toBe(false);
  });
});
