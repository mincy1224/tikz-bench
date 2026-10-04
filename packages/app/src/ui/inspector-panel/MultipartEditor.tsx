import { useRef, useState } from "react";
import { getEditableNodeParts, updateNodePart, updateNodePartFill } from "tikz-editor/edit/multipart";
import { useEditorStore } from "../../store/store";
import { usePropertyEditSession } from "./usePropertyEditSession";
import css from "./InspectorPanel.module.css";

export function MultipartEditor({ elementId }: { elementId: string }) {
  const source = useEditorStore((state) => state.source);
  const model = getEditableNodeParts(source, elementId);
  const { update, cancel } = usePropertyEditSession(`parts:${elementId}`);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [composing, setComposing] = useState(false);
  const skipBlur = useRef(false);
  if (!model) return null;
  const optionValue = (name: string): string => {
    const entry = model.target.options?.entries.slice().reverse().find((item) => item.kind === "kv" && item.key === name);
    return entry?.kind === "kv" ? entry.valueRaw : "";
  };
  const fills = optionValue("rectangle split part fill").replace(/^\{|\}$/gu, "").split(",").map((value) => value.trim());
  const changeText = (index: number, text: string, preview: boolean) => { update((base) => updateNodePart(base, elementId, index, "text", text), preview); };
  return <section className={css.multipartEditor} aria-label="分区矩形编辑">
    <h3>分区内容 <small>{model.count} 个分区</small></h3>
    {Array.from({ length: model.count }, (_, index) => {
      const part = model.parts.slice().reverse().find((candidate) => candidate.logicalIndex === index);
      const localValue = (name: string): string => {
        const entry = part?.options?.entries.slice().reverse().find((item) => item.kind === "kv" && item.key === name);
        return entry?.kind === "kv" ? entry.valueRaw : "";
      };
      const fill = (fills[index] ?? fills.at(-1)) || optionValue("fill") || "none";
      return <details key={index} open className={css.partitionCard}>
        <summary>分区 {index + 1}</summary>
        <textarea aria-label={`分区 ${index + 1} 内容`} rows={2}
          placeholder="文字或 $公式$" value={drafts[index] ?? part?.text ?? ""}
          onCompositionStart={() => { setComposing(true); }}
          onCompositionEnd={(event) => { setComposing(false); changeText(index, event.currentTarget.value, true); }}
          onChange={(event) => { setDrafts({ ...drafts, [index]: event.target.value }); if (!composing) changeText(index, event.target.value, true); }}
          onBlur={(event) => { if (!skipBlur.current && drafts[index] !== undefined) changeText(index, event.target.value, false); skipBlur.current = false; setDrafts({}); }}
          onKeyDown={(event) => { if (event.key === "Escape") { skipBlur.current = true; cancel(); setDrafts({}); event.currentTarget.blur(); } }} />
        <div className={css.precisionGrid}>
          <label><span>填色</span><input aria-label={`分区 ${index + 1} 填色`} placeholder="none / red!15" defaultValue={fill} key={`${elementId}:${index}:fill:${fill}`}
            onBlur={(event) => { if (event.target.value && event.target.value !== fill) update((base) => updateNodePartFill(base, elementId, index, event.target.value), false); }} /></label>
          <label><span>对齐</span><select aria-label={`分区 ${index + 1} 对齐`} disabled={!part}
            value={localValue("align") || "center"}
            onChange={(event) => { update((base) => updateNodePart(base, elementId, index, "align", event.target.value), false); }}>
            <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
          </select></label>
          <label><span>字号</span><select aria-label={`分区 ${index + 1} 字号`} disabled={!part} value={localValue("font")} onChange={(event) => { update((base) => updateNodePart(base, elementId, index, "font", event.target.value), false); }}>
            <option value="">继承</option><option value="\small">小</option><option value="\normalsize">正常</option><option value="\large">大</option><option value="\Large">更大</option>
          </select></label>
        </div>
      </details>;
    })}
  </section>;
}
