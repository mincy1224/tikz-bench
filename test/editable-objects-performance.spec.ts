import { describe, expect, it } from "vitest";
import { editableObjects } from "../packages/core/src/edit/editable-objects";
import { evaluateSemantic } from "./semantic/helpers";
import { parseTikz } from "../packages/core/src/parser/index";

describe("large-document editable object queries", () => {
  it("parses once rather than once per scene object, and limits selection queries", () => {
    const source = "\\begin{tikzpicture}\n" + Array.from({ length: 400 }, (_, i) => `\\node[draw,circle] (n${i}) at (${i % 20},${Math.floor(i / 20)}) {${i}};`).join("\n") + "\n\\end{tikzpicture}";
    const scene = evaluateSemantic(source).scene;
    const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
    let parses = 0;
    const previous = globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__;
    globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__ = {
      incrementCounter: (counter) => { if (counter === "parseTikzCalls") parses++; },
      recordComputeTiming: () => {}, recordSvgPatchTiming: () => {}, recordSourcePanelSyncTiming: () => {}
    };
    try {
      const objects = editableObjects(source, scene.elements);
      expect(objects).toHaveLength(400);
      expect(parses).toBe(1);
      parses = 0;
      expect(editableObjects(source, scene.elements, new Set([objects[250].id]), parsed)).toEqual([objects[250]]);
      expect(parses).toBe(0);
      expect(editableObjects(source, scene.elements, new Set())).toEqual([]);
      expect(parses).toBe(0);
      parses = 0;
      const selected = editableObjects(source, scene.elements, new Set([objects[250].id]));
      expect(selected).toHaveLength(1);
      expect(selected[0].type).toBe("tikz:circle");
      expect(selected[0].properties).toEqual(objects[250].properties);
      expect(parses).toBe(1);
    } finally { globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__ = previous; }
  });
});
