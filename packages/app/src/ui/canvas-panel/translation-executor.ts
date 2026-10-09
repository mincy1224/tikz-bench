import type { OperationPlan } from "tikz-editor/edit/prepared-translation";
import type { WorldPoint } from "tikz-editor/coords/points";
import type { SourceEditTransaction } from "../../store/source-edit-transaction";
import type { ElementTranslationPreview } from "./element-translation-preview";

/** Mouse and keyboard share one execution policy and source-version guard. */
export function previewTranslation(transaction: SourceEditTransaction, plan: OperationPlan, visual: ElementTranslationPreview | null | undefined, delta: WorldPoint): void {
  if (!transaction.valid()) throw new Error("源码已改变，移动已取消。");
  if (visual) visual.move(delta.x, delta.y);
  else if (!transaction.previewEdit(() => ({ ...plan.apply(new Map(plan.ids.map((id) => [id, delta]))), changedSourceIds: plan.changedSourceIds }))) throw new Error("源码已改变，移动已取消。");
}

export function commitTranslationPreview(transaction: SourceEditTransaction, plan: OperationPlan, delta: WorldPoint): string {
  const edit = plan.apply(new Map(plan.ids.map((id) => [id, delta])));
  if (!transaction.previewEdit(() => ({ ...edit, changedSourceIds: plan.changedSourceIds }))) throw new Error("源码已改变，移动已取消。");
  return edit.source;
}
