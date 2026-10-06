import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index";
import { getEditableNodeParts, updateNodePart, updateNodePartFill } from "../packages/core/src/edit/multipart";
import { buildArrowTipSizeMutation, buildArrowTipSetPropertyMutation } from "../packages/core/src/edit/property-write-builders";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer";
import { evaluateSemantic } from "./semantic/helpers";
import { createStandaloneDocument, resolveCompileProfile } from "../apps/server/src/latex/compiler";
import { applyEditAction } from "../packages/core/src/edit/actions";
import { collectArrangeWorldBounds } from "../packages/core/src/edit/scope-bounds";
import { worldPoint } from "../packages/core/src/coords/points";
import { pt } from "../packages/core/src/coords/scalars";
import { getEditActionAvailability } from "../packages/core/src/edit/action-availability";

const source = String.raw`\begin{tikzpicture}\node[rectangle split,rectangle split parts=3,rectangle split horizontal,draw,rectangle split part fill={white,none,red!15}] {First\nodepart[font=\small]{two}Second\nodepart{three}Third};\end{tikzpicture}`;
function nodeId() {
  const statement = parseTikz(source).figure.body[0];
  if (statement.kind !== "Path") throw new Error("Missing path");
  const node = statement.items.find((item) => item.kind === "Node");
  if (!node) throw new Error("Missing node");
  return node.id;
}
describe("multipart source editing", () => {
  it("reparses ranges after changing the preceding part, retaining local options", () => {
    const id = nodeId();
    const a = updateNodePart(source, id, 0, "text", "A much longer first partition");
    const b = updateNodePart(a, id, 1, "text", "独立内容 $x^2$");
    const parts = getEditableNodeParts(b, id)!.parts;
    expect(parts.map((part) => part.text)).toEqual(["A much longer first partition", "独立内容 $x^2$", "Third"]);
    expect(b).toContain(String.raw`\nodepart[font=\small]{two}`);
  });
  it("retains transparent slots when another partition changes color", () => {
    const changed = updateNodePartFill(source, nodeId(), 2, "blue!15");
    expect(changed).toContain("rectangle split uses custom fill");
    expect(changed).not.toContain("rectangle split use custom fill");
    expect(changed).toContain("white,none,blue!15");
    const result = evaluateSemantic(changed);
    expect(result.scene.elements.some((element) => element.style.fill === "#d9d9ff")).toBe(true);
  });
  it("uses distinct source spans and local font metrics", () => {
    const texts = evaluateSemantic(source).scene.elements.filter((element) => element.kind === "Text");
    expect(texts.map((element) => source.slice(element.textSourceSpan!.from, element.textSourceSpan!.to))).toEqual(["First", "Second", "Third"]);
    expect(texts[1].style.fontSize).toBeLessThan(texts[0].style.fontSize);
  });
  it("removes the formerly emitted misspelled key when editing fill", () => {
    const legacy = source.replace("rectangle split parts=3", "rectangle split parts=3,rectangle split use custom fill");
    const changed = updateNodePartFill(legacy, nodeId(), 0, "green");
    expect(changed).not.toContain("rectangle split use custom fill");
    expect(changed).toContain("rectangle split uses custom fill");
  });
});
describe("structured arrow sizes", () => {
  const context = { startRaw: "Circle[open,scale=1.5]", endRaw: "Stealth[length=8pt,width=5pt,round]", clearKeys: [] };
  it("preserves the other side and existing valid options", () => {
    expect(buildArrowTipSizeMutation(context, "end", "width", "7pt").value).toBe("Circle[open,scale=1.5]-Stealth[length=8pt, round, width=7pt]");
    expect(buildArrowTipSetPropertyMutation(context, "end", "latex").value).toContain("Latex[length=8pt,width=5pt,round]");
  });
  it("resets sizes without removing other options", () => {
    expect(buildArrowTipSizeMutation(context, "end", "reset", "").value).toBe("Circle[open,scale=1.5]-Stealth[round]");
  });
});
describe("property transactions", () => {
  it("commits repeated previews as one undoable action", () => {
    let state = editorReducer(makeInitialState(), { type: "LOAD_PROJECT", source, title: "Test" });
    state = editorReducer(state, { type: "SET_SOURCE_TRANSIENT", source: "preview one" });
    state = editorReducer(state, { type: "SET_SOURCE_TRANSIENT", source: "preview two" });
    expect(state.history.length).toBe(0);
    state = editorReducer(state, { type: "COMMIT_PROPERTY_SOURCE", source: "committed", expectedSource: "preview two" });
    expect(state.history.length).toBe(1);
    expect(state.documents[state.activeDocumentId].propertyPreviewBaseSource).toBeUndefined();
    expect(editorReducer(state, { type: "UNDO" }).source).toBe(source);
  });
  it("rejects a commit against stale source", () => {
    const state = makeInitialState();
    expect(editorReducer(state, { type: "COMMIT_PROPERTY_SOURCE", source: "bad", expectedSource: "stale" })).toBe(state);
  });
});
describe("compilation profiles", () => {
  it("selects Chinese XDV and includes requested advanced packages", () => {
    expect(resolveCompileProfile("中文")).toBe("xelatex");
    expect(resolveCompileProfile("Latin")).toBe("latex");
    expect(createStandaloneDocument(String.raw`\begin{forest}[中文]\end{forest}`)).toContain("\\usepackage{forest}");
    expect(createStandaloneDocument(String.raw`\begin{axis}\end{axis}`)).toContain("\\usepackage{pgfplots}");
    expect(createStandaloneDocument(String.raw`\begin{circuitikz}\end{circuitikz}`)).toContain("\\usepackage{circuitikz}");
  });
});

describe("groups and persistent anchors", () => {
  it("enables and aligns groups as whole objects", () => {
    const grouped = String.raw`\begin{tikzpicture}\begin{scope}\draw (0,0) rectangle (1,1);\draw (1,0)--(2,0);\end{scope}\begin{scope}\draw (4,2) rectangle (5,3);\end{scope}\end{tikzpicture}`;
    const parsed = parseTikz(grouped);
    const ids = parsed.figure.body.map((statement) => statement.id);
    const scene = evaluateSemantic(grouped);
    const availability = getEditActionAvailability({ source: grouped, snapshotSource: grouped, scene: scene.scene, editHandles: scene.editHandles, selectedSourceIds: ids });
    expect(availability["align-left"].enabled).toBe(true);
    const aligned = applyEditAction(grouped, scene.editHandles, { kind: "alignElements", elementIds: ids, mode: "left" });
    if (aligned.kind !== "success") throw new Error(JSON.stringify(aligned));
    const after = evaluateSemantic(aligned.newSource);
    const bounds = collectArrangeWorldBounds(after.scene.elements, parseTikz(aligned.newSource).figure.body);
    expect(Math.abs(bounds.get(ids[0])!.minX - bounds.get(ids[1])!.minX)).toBeLessThan(0.02);
    expect(aligned.newSource).toContain("\\draw (4,2) rectangle (5,3)");
  });
  it("moves the connected line with a named multipart node", () => {
    const connected = String.raw`\begin{tikzpicture}\node[rectangle split,rectangle split parts=2,draw] (A) at (0,0) {A\nodepart{two}B};\draw (A.east)--(3,0);\end{tikzpicture}`;
    const before = evaluateSemantic(connected);
    const start = before.editHandles.find((handle) => handle.sourceRef.sourceId === "path:1")!.world;
    const moved = applyEditAction(connected, before.editHandles, { kind: "moveElement", elementId: "path:0", delta: worldPoint(pt(20), pt(10)), formatPrecision: "fine" });
    if (moved.kind !== "success") throw new Error(JSON.stringify(moved));
    expect(moved.newSource).toContain("(A.east)");
    const after = evaluateSemantic(moved.newSource);
    const nextStart = after.editHandles.find((handle) => handle.sourceRef.sourceId === "path:1")!.world;
    const oldCenter = before.editHandles.find((handle) => handle.sourceRef.sourceId === "path:0" && handle.kind === "node-position")!.world;
    const newCenter = after.editHandles.find((handle) => handle.sourceRef.sourceId === "path:0" && handle.kind === "node-position")!.world;
    expect(nextStart.x - start.x).toBeCloseTo(newCenter.x - oldCenter.x, 6);
    expect(nextStart.y - start.y).toBeCloseTo(newCenter.y - oldCenter.y, 6);
  });
});
