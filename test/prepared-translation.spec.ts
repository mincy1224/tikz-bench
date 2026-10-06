import { describe, expect, it } from "vitest";
import { prepareTranslation } from "../packages/core/src/edit/prepared-translation";
import { collectGeometryInvalidation } from "../packages/core/src/semantic/dependencies";
import { evaluateSemantic } from "./semantic/helpers";
import { pt, worldPoint } from "../packages/core/src/coords/index";

describe("prepared translation", () => {
  it("computes repeated previews from the immutable baseline and preserves group styles", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=20,draw=red]\draw (0,0) rectangle (1,1);\end{scope}\end{tikzpicture}`;
    const plan = prepareTranslation(source, evaluateSemantic(source).editHandles, ["scope:0"])!;
    const preview = (x: number) => plan.apply(new Map([["scope:0", worldPoint(pt(x), pt(0))]])).source;
    const first = preview(10);
    expect(preview(20)).toContain("shift={(20pt,0pt)},rotate=20,draw=red");
    expect(preview(10)).toBe(first);
    expect(preview(0)).toBe(source);
  });
  it("has no external geometry dependencies for six independent shapes", () => {
    const source = "\\begin{tikzpicture}" + Array.from({ length: 206 }, (_, i) => `\\draw (${i},0) rectangle (${i + 0.6},0.6);`).join("\n") + "\\end{tikzpicture}";
    const semantic = evaluateSemantic(source);
    const ids = Array.from({ length: 6 }, (_, i) => `path:${i}`);
    const plan = prepareTranslation(source, semantic.editHandles, ids)!;
    expect(plan).not.toBeNull();
    const affected = collectGeometryInvalidation(semantic.dependencies, { changedSourceIds: [...plan.movingSourceIds] });
    expect(affected.reachedOpaque).toBe(false);
    expect(affected.affectedSourceIds.filter((id) => !plan.movingSourceIds.has(id))).toEqual([]);
  });
});
