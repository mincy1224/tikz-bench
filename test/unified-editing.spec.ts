import { describe, expect, it } from "vitest";
import { advancedEffectiveOptions, editForestStructure, parseAdvancedObjects, setAdvancedContent, setAdvancedOption } from "../packages/core/src/edit/advanced-objects";
import { instrumentAdvancedDocument } from "../packages/core/src/edit/advanced-instrumentation";
import { applyFormat, captureFormat, editableObjects } from "../packages/core/src/edit/editable-objects";
import { applyEditAction } from "../packages/core/src/edit/actions";
import { parseTikz } from "../packages/core/src/parser/index";
import { shapeAnchorNodeSource } from "../packages/core/src/edit/shape-anchor-node";
import { evaluateSemantic } from "./semantic/helpers";
import { CoalescingSaveQueue } from "../apps/web/src/coalescing-save-queue";
import { pt, worldPoint } from "../packages/core/src/coords/index";
import { buildSnapContext, collectSelectionGeometryFromBounds, snapSelectionTranslation } from "../packages/core/src/edit/snapping";
import { nodePartProperty, updateNodePartFill } from "../packages/core/src/edit/multipart";
import { collectArrangeWorldBounds } from "../packages/core/src/edit/scope-bounds";

const forest = String.raw`\begin{forest}for tree={rectangle split,rectangle split parts=2,font=\small,draw=black}
[{Root \nodepart{two} 根节点},fill=white
 [{A \nodepart{two} 内容},draw=red]
 [{B},fill=none]
]\end{forest}`;
describe("unified advanced source edits", () => {
  it("keeps sibling content and global tree defaults untouched", () => {
    const objects = parseAdvancedObjects(forest).objects;
    expect(objects).toHaveLength(3);
    const changed = setAdvancedContent(forest, objects[1].id, "Different $x^2$");
    expect(changed).toContain("[{B},fill=none]");
    expect(advancedEffectiveOptions(changed, parseAdvancedObjects(changed).objects[1]).get("rectangle split parts")).toBe("2");
    const next = setAdvancedOption(changed, objects[1].id, "inner xsep", "8pt");
    expect(next).toContain("draw=red");
    expect(next).toContain("inner xsep=8pt");
    expect(next).toContain("for tree={rectangle split,rectangle split parts=2,font=\\small,draw=black}");
  });
  it("adds and promotes children using balanced source ranges", () => {
    const root = parseAdvancedObjects(forest).objects[0];
    const grown = editForestStructure(forest, root.id, "child");
    expect(parseAdvancedObjects(grown).objects).toHaveLength(4);
    const tree = String.raw`\begin{forest}[{Root}[{Branch}[{A}][{B}]][{Sibling}]]\end{forest}`;
    const branch = parseAdvancedObjects(tree).objects[1];
    const promoted = editForestStructure(tree, branch.id, "promote");
    expect(parseAdvancedObjects(promoted).objects.map((object) => object.label)).toEqual(["Root", "A", "B", "Sibling"]);
    expect(() => editForestStructure(forest, root.id, "promote")).toThrow("根节点");
  });
  it("recognizes addplot+ coordinate and function payloads", () => {
    const source = String.raw`\begin{tikzpicture}\begin{axis}[xlabel={$x$}]\addplot+[red,only marks] coordinates {(1,2) (3,4)};\addplot[blue,domain=0:2] {x^2};\end{axis}\end{tikzpicture}`;
    const objects = parseAdvancedObjects(source).objects;
    expect(objects.map((object) => object.type)).toEqual(["plot:axis", "plot:scatter", "plot:function"]);
    expect(objects[1].data!.map((point) => source.slice(point.span.from, point.span.to))).toEqual(["(1,2)", "(3,4)"]);
    expect(setAdvancedOption(source, objects[1].id, "draw", "green")).toContain("\\addplot+[red,only marks,draw=green]");
  });
  it("instruments only a compile copy with deterministic mappings", () => {
    const compiled = instrumentAdvancedDocument(forest);
    expect(compiled.bindings).toHaveLength(3);
    expect(compiled.source).toContain("dvisvgm:raw");
    expect(compiled.source).toContain("alias=tbEditable");
    expect(forest).not.toContain("tbEditable");
    expect(compiled.sourceVersion).toBe(instrumentAdvancedDocument(forest).sourceVersion);
  });
  it("captures inherited Forest font and refuses cross-type brushing", () => {
    const objects = editableObjects(forest);
    const snapshot = captureFormat(objects[1]);
    expect(snapshot.properties.get("font-size")).toBe("9pt");
    const changed = applyFormat(forest, objects[2], snapshot);
    expect(changed).toContain("draw=red");
    expect(changed).toContain("\\fontsize{9pt}");
    expect(() => applyFormat(forest, { ...objects[2], type: "tikz:rectangle" }, snapshot)).toThrow("相同组件类型");
  });
});
describe("shape anchor promotion and transformed ungroup", () => {
  it.each(["(0,0) rectangle (2,1)", "(0,0) circle (1cm)", "(0,0) ellipse (1cm and 0.5cm)"])("names %s without losing its bounds", (primitive) => {
    const source = `\\begin{tikzpicture}\\draw[red,line width=1pt] ${primitive};\\end{tikzpicture}`;
    const statement = parseTikz(source).figure.body[0];
    if (statement.kind !== "Path") throw new Error("path");
    const node = shapeAnchorNodeSource(source, statement, "connected", {});
    expect(node).not.toBeNull();
    const next = source.slice(0, statement.span.from) + node + source.slice(statement.span.to);
    const before = collectArrangeWorldBounds(evaluateSemantic(source).scene.elements, parseTikz(source).figure.body).get(statement.id)!;
    const after = collectArrangeWorldBounds(evaluateSemantic(next).scene.elements, parseTikz(next).figure.body).get(statement.id)!;
    for (const key of ["minX", "maxX", "minY", "maxY"] as const) expect(after[key]).toBeCloseTo(before[key], 1);
  });
  it("ungroups transformed scopes while preserving appearance and anchors", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[xshift=1cm,scale=2,red]\node[draw] (A) at (0,0) {A};\node[draw] (B) at (1,0) {B};\end{scope}\draw (A.east)--(B.west);\end{tikzpicture}`;
    const before = evaluateSemantic(source);
    const result = applyEditAction(source, before.editHandles, { kind: "ungroupElements", elementIds: [parseTikz(source).figure.body[0].id] });
    expect(result.kind).toBe("success"); if (result.kind !== "success") return;
    expect(result.newSource).toContain("name=__tikz_bench_semantic");
    expect(result.newSource).toContain("(A.east)--(B.west)");
    expect(evaluateSemantic(result.newSource).scene.elements.map((element) => element.style)).toEqual(before.scene.elements.map((element) => element.style));
  });
});
describe("bounded save queue", () => {
  it("merges all queued updates behind one in-flight request", async () => {
    const calls: { source?: string; name?: string }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = new CoalescingSaveQueue<{ source?: string; name?: string }, number>(async (patch) => { calls.push(patch); if (calls.length === 1) await gate; return calls.length; });
    const first = queue.enqueue({ source: "first" });
    const pending = Array.from({ length: 100 }, (_, index) => queue.enqueue({ source: String(index) }));
    const name = queue.enqueue({ name: "New" }); release();
    await Promise.all([first, ...pending, name]);
    expect(calls).toEqual([{ source: "first" }, { source: "99", name: "New" }]);
    expect(queue.busy).toBe(false);
  });
});

describe("group smart guides and partition formatting", () => {
  it("uses complete group bounds for alignment guides without self-snapping", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}\draw (0,0) rectangle (1,1);\draw (1,0)--(2,0);\end{scope}\begin{scope}\draw (4,2) rectangle (5,3);\end{scope}\end{tikzpicture}`;
    const parsed = parseTikz(source); const scene = evaluateSemantic(source).scene;
    const group = parsed.figure.body[0]; if (group.kind !== "Scope") throw new Error("scope");
    const excluded = [group.id, ...group.body.map((child) => child.id)];
    const bounds = collectArrangeWorldBounds(scene.elements, parsed.figure.body);
    const context = buildSnapContext({ sceneElements: scene.elements, referenceBounds: bounds, selectedSourceIds: excluded, zoom: 1 });
    expect(context.referenceBounds.every((item) => !excluded.includes(item.sourceId))).toBe(true);
    const selection = collectSelectionGeometryFromBounds(new Map([...bounds].map(([id, value]) => [id, Object.assign(value, { sourceId: id })])), [group.id])!;
    const target = bounds.get(parsed.figure.body[1].id)!;
    const snapped = snapSelectionTranslation({ context, selection, rawDelta: worldPoint(pt(target.minX - selection.bounds.minX + 1), pt(0)) });
    expect(snapped.lines.length).toBeGreaterThan(0);
  });
  it("shows inherited and transparent partition fills without shifting colors", () => {
    const id = parseAdvancedObjects(forest).objects[0].id;
    const one = updateNodePartFill(forest, id, 0, "none"); const two = updateNodePartFill(one, id, 1, "red!15");
    expect(nodePartProperty(two, id, 0, "fill")).toBe("none");
    expect(nodePartProperty(two, id, 1, "fill")).toBe("red!15");
    expect(advancedEffectiveOptions(two, parseAdvancedObjects(two).objects[0]).get("rectangle split uses custom fill")).toBe("true");
  });
  it("does not interpret brackets inside braced Forest labels as children", () => {
    expect(parseAdvancedObjects(String.raw`\begin{forest}[{Range [a,b]} [{Child}]]\end{forest}`).objects).toHaveLength(2);
  });
});

describe("format painter semantic node types", () => {
  it("distinguishes nodes by their local shape and writes inside their own options", () => {
    const source = String.raw`\begin{tikzpicture}\node[draw=red] (A) {A};\node[circle,draw] (B) at (2,0) {B};\end{tikzpicture}`;
    const objects = editableObjects(source, evaluateSemantic(source).scene.elements);
    expect(objects.map((object) => object.type)).toEqual(["tikz:rectangle", "tikz:circle"]);
    expect(() => applyFormat(source, objects[1], captureFormat(objects[0]))).toThrow("相同组件类型");
  });
});

describe("nested group resize world geometry", () => {
  it("keeps opposite edges fixed under a rotated parent and still ungroups", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=20,xshift=1cm,scale=1.4]\begin{scope}[rotate=30]\draw (0,0) rectangle (2,1);\end{scope}\end{scope}\end{tikzpicture}`;
    const parsed = parseTikz(source); const parent = parsed.figure.body[0]; if (parent.kind !== "Scope") throw new Error("scope");
    const id = parent.body[0].id; const before = collectArrangeWorldBounds(evaluateSemantic(source).scene.elements, parsed.figure.body).get(id)!;
    const result = applyEditAction(source, [], { kind: "resizeElement", elementId: id, role: "top-right", newWorld: worldPoint(pt(before.maxX + 20), pt(before.maxY + 10)), referenceBounds: before });
    expect(result.kind).toBe("success"); if (result.kind !== "success") return;
    const after = collectArrangeWorldBounds(evaluateSemantic(result.newSource).scene.elements, parseTikz(result.newSource).figure.body).get(id)!;
    expect(after.minX).toBeCloseTo(before.minX, 2); expect(after.minY).toBeCloseTo(before.minY, 2);
    expect(after.maxX).toBeCloseTo(before.maxX + 20, 2); expect(after.maxY).toBeCloseTo(before.maxY + 10, 2);
    expect(applyEditAction(result.newSource, [], { kind: "ungroupElements", elementIds: [id] }).kind).toBe("success");
  });
});

describe("whole versus geometry-only node scaling", () => {
  it("scales local font and line width only in whole mode", () => {
    const source = String.raw`\begin{tikzpicture}\node[draw,minimum width=60pt,minimum height=30pt,line width=2pt,font=\fontsize{12pt}{14pt}\selectfont] (A) at (0,0) {A};\end{tikzpicture}`;
    const before = evaluateSemantic(source); const id = parseTikz(source).figure.body[0].id;
    const bounds = collectArrangeWorldBounds(before.scene.elements, parseTikz(source).figure.body).get(id)!;
    const newWorld = worldPoint(pt(bounds.minX + (bounds.maxX - bounds.minX) * 2), pt(bounds.minY + (bounds.maxY - bounds.minY) * 2));
    const geometry = applyEditAction(source, [], { kind: "resizeElement", elementId: id, role: "top-right", newWorld });
    const whole = applyEditAction(source, [], { kind: "resizeElement", elementId: id, role: "top-right", newWorld, scaleContents: true });
    expect(geometry.kind).toBe("success"); expect(whole.kind).toBe("success"); if (geometry.kind !== "success" || whole.kind !== "success") return;
    expect(evaluateSemantic(geometry.newSource).scene.elements.find((element) => element.kind === "Text")!.style.fontSize).toBe(12);
    expect(evaluateSemantic(whole.newSource).scene.elements.find((element) => element.kind === "Text")!.style.fontSize).toBeGreaterThan(20);
    expect(evaluateSemantic(whole.newSource).scene.elements[0].style.lineWidth).toBeGreaterThan(3);
  });
});
