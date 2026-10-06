import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index";
import { applyEditAction } from "../packages/core/src/edit/actions";
import { collectArrangeWorldBounds } from "../packages/core/src/edit/scope-bounds";
import { evaluateSemantic } from "./semantic/helpers";

describe("world bounds alignment of groups", () => {
  for (const frame of ["plain", "nested", "picture"] as const) for (const mode of ["left", "center", "right", "top", "middle", "bottom"] as const) it(`${mode}, frame=${frame}`, () => {
    const nested = frame === "nested";
    const groups = String.raw`\begin{scope}[rotate=20,xscale=1.3]\draw (0,0) rectangle (1,1);\draw (1,0)--(2,1);\end{scope}
\begin{scope}[xshift=110pt,yshift=55pt,rotate=-15]\draw (0,0) circle (0.4cm);\draw (0,0)--(1,1);\end{scope}`;
    const source = "\\begin{tikzpicture}" + (frame === "picture" ? "[rotate=35,xscale=1.5,yscale=0.8]" : "") + (nested ? "\\begin{scope}[rotate=35,xscale=1.5,yscale=0.8]" : "") + groups + (nested ? "\\end{scope}" : "") + "\\end{tikzpicture}";
    const parsed = parseTikz(source);
    const body = nested && parsed.figure.body[0].kind === "Scope" ? parsed.figure.body[0].body : parsed.figure.body;
    const ids = body.filter((item) => item.kind === "Scope").map((item) => item.id);
    const result = applyEditAction(source, [], { kind: "alignElements", elementIds: ids, mode });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const bounds = collectArrangeWorldBounds(evaluateSemantic(result.newSource).scene.elements, parseTikz(result.newSource).figure.body);
    const coordinate = (id: string) => { const b = bounds.get(id)!; return mode === "left" ? b.minX : mode === "center" ? (b.minX + b.maxX) / 2 : mode === "right" ? b.maxX : mode === "top" ? b.maxY : mode === "middle" ? (b.minY + b.maxY) / 2 : b.minY; };
    expect(Math.abs(coordinate(ids[0]) - coordinate(ids[1]))).toBeLessThan(0.02);
  });
});
