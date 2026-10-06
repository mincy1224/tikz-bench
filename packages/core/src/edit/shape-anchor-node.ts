import type { PathStatement } from "../ast/types.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { parseCircleRadiusFromCoordinateRaw, parseEllipseRadiiFromCoordinateRaw } from "../semantic/path/parsers.js";
import { formatNumber } from "./format.js";

/** Promote a primitive path to an equivalent named node when it first connects. */
export function shapeAnchorNodeSource(source: string, statement: PathStatement, name: string, parseOptions: EditParseOptions): string | null {
  if (statement.items.some((item) => item.kind === "Node")) return null;
  const parsed = parseTikzForEdit(source, parseOptions);
  const elements = evaluateTikzFigure(parsed.figure, source).scene.elements.filter((element) => element.sourceRef.sourceId === statement.id && !element.adornment);
  if (elements.length !== 1) return null;
  const element = elements[0];
  const coords = statement.items.filter((item) => item.kind === "Coordinate");
  if (!coords.length || coords[0].form !== "cartesian" || coords[0].relativePrefix) return null;
  let shape: string; let width: number; let height: number;
  let at = coords[0].raw;
  if (element.kind === "Circle") { const radius = coords[1] ? parseCircleRadiusFromCoordinateRaw(coords[1].raw) : null; if (!radius) return null; shape = "circle"; width = height = 2 * radius.value; }
  else if (element.kind === "Ellipse") { const radii = coords[1] ? parseEllipseRadiiFromCoordinateRaw(coords[1].raw) : null; if (!radii) return null; shape = "ellipse"; width = 2 * radii.rx.value; height = 2 * radii.ry.value; }
  else if (element.kind === "Path" && element.shapeHint === "rectangle" && coords.length === 2) {
    if (coords[1].form !== "cartesian" || coords[1].relativePrefix) return null;
    const [a, b] = coords;
    const x1 = parseLength(a.x, "cm"); const y1 = parseLength(a.y, "cm");
    const x2 = parseLength(b.x, "cm"); const y2 = parseLength(b.y, "cm");
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    shape = "rectangle"; width = Math.abs(x2 - x1); height = Math.abs(y2 - y1);
    at = `(${formatNumber((x1 + x2) / 2)}pt,${formatNumber((y1 + y2) / 2)}pt)`;
  } else return null;
  const paint = statement.command === "fill" ? "fill" : statement.command === "filldraw" ? "draw,fill" : "draw";
  const original = statement.options?.entries.map((entry) => entry.raw).join(",") ?? "";
  return `\\node[${paint}${original ? `,${original}` : ""},shape=${shape},transform shape,inner sep=0pt,outer sep=0pt,minimum width=${formatNumber(width)}pt,minimum height=${formatNumber(height)}pt] (${name}) at ${at} {};`;
}
