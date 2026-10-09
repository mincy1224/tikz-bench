import type { SemanticContext } from "../context.js";
import type { WorldPoint } from "../../coords/points.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { OptionListAst } from "../../options/types.js";
import type { NodeShape } from "./types.js";
import type { NodeLayout } from "./types.js";
import { currentAnchorForDirection, targetAnchorForDirection, type PositioningDirection } from "../path/node-positioning.js";
import { nodeAnchorOffset } from "./anchors.js";
import { applyMatrixToVector } from "../transform.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
const CONTINUOUS_POSITIONING_DIRECTIONS: PositioningDirection[] = [
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right"
];

export function computePositioningAnchorOffsetsByDirection(params: {
  targetNodeName: string;
  targetCenter: WorldPoint;
  currentCenter: WorldPoint;
  context: SemanticContext;
  legacyOf: boolean;
  nodeShape: NodeShape;
  nodeLayout: NodeLayout;
  nodeOptions: OptionListAst | undefined;
  nodeTransform: WorldTransform;
}): Record<string, { targetAnchor: WorldPoint; currentAnchor: WorldPoint }> {
  const {
    targetNodeName,
    targetCenter,
    context,
    legacyOf,
    nodeShape,
    nodeLayout,
    nodeOptions,
    nodeTransform
  } = params;
  const offsets: Record<string, { targetAnchor: WorldPoint; currentAnchor: WorldPoint }> = {};

  for (const direction of CONTINUOUS_POSITIONING_DIRECTIONS) {
    const currentAnchor = applyMatrixToVector(
      nodeTransform,
      nodeAnchorOffset(nodeShape, nodeLayout, currentAnchorForDirection(direction), nodeOptions)
    );
    let targetAnchor: WorldPoint = worldPoint(pt(0), pt(0));

    if (!legacyOf) {
      const targetAnchorWorldPoint = evaluateRawCoordinate(
        `(${targetNodeName}.${targetAnchorForDirection(direction)})`,
        context
      ).world;
      if (targetAnchorWorldPoint) {
        targetAnchor = worldPoint(
          pt(targetAnchorWorldPoint.x - targetCenter.x),
          pt(targetAnchorWorldPoint.y - targetCenter.y)
        );
      }
    }

    offsets[direction] = {
      targetAnchor,
      currentAnchor: worldPoint(pt(currentAnchor.x), pt(currentAnchor.y))
    };
  }

  return offsets;
}
