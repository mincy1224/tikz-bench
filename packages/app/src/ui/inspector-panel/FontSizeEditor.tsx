import { useRef, useState } from "react";
import { applyEditAction } from "tikz-editor/edit/actions";
import { buildNodeFontSetPropertyMutation, type NodeFontMutationContext } from "tikz-editor/edit/property-write-builders";
import type { SetPropertyWriteTarget } from "tikz-editor/edit/inspector";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { NODE_FONT_PRESET_BY_ID } from "tikz-editor/edit/inspector/presets";
import { usePropertyEditSession } from "./usePropertyEditSession";
import css from "./InspectorPanel.module.css";

type Values = Parameters<typeof buildNodeFontSetPropertyMutation>[1];
export function FontSizeEditor({ targets }: { targets: Array<{ write: SetPropertyWriteTarget; context: NodeFontMutationContext; values: Values }> }) {
  const { update, cancel, error } = usePropertyEditSession(`font:${targets.map(({ write }) => write.elementId).join(",")}`);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);
  const sizes = targets.map(({ context, values }) => {
    const preset = values.sizePreset === "custom" ? null : NODE_FONT_PRESET_BY_ID.get(values.sizePreset);
    return preset ? 10 * preset.scale : (values.customSizePt ?? context.fallbackCustomSizePt);
  });
  const mixed = sizes.some((size) => Math.abs(size - (sizes[0] ?? 10)) > 0.001);
  const value = sizes[0] ?? 10;
  const writable = targets.some(({ write }) => write.writable);
  const change = (raw: string, preview: boolean) => {
    const size = parseLength(raw.trim(), "pt");
    if (size == null || !Number.isFinite(size) || size <= 0) { setInvalid(true); if (!preview) cancel(); return; }
    setInvalid(false);
    update((source) => {
      let next = source;
      for (const target of targets) {
        if (!target.write.writable) continue;
        const mutation = buildNodeFontSetPropertyMutation(target.context, { ...target.values, sizePreset: "custom", customSizePt: size });
        const result = applyEditAction(next, [], { kind: "setProperty", elementId: target.write.elementId, level: target.write.level, ...mutation });
        if (result.kind !== "success" && result.kind !== "partial") throw new Error("字号目标已变化，请重新选择图形。");
        next = result.newSource;
      }
      return next;
    }, preview);
  };
  return <div className={css.fontPrecision}>
    <label>字号 <input aria-label="字号（pt）" inputMode="decimal" disabled={!writable} aria-invalid={invalid}
      placeholder={mixed ? "多个值" : "10"} value={draft ?? (mixed ? "" : String(Math.round(value * 100) / 100))}
      onChange={(event) => { setDraft(event.target.value); change(event.target.value, true); }}
      onBlur={(event) => { if (!skipBlur.current && draft !== null) change(event.target.value, false); skipBlur.current = false; setDraft(null); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); skipBlur.current = true; cancel(); setDraft(null); event.currentTarget.blur(); } }}
    /><span>pt</span></label>
    <button type="button" disabled={!writable} aria-label="减小字号" onClick={() => { change(String(Math.max(1, value - 2)), false); }}>A−</button>
    <button type="button" disabled={!writable} aria-label="增大字号" onClick={() => { change(String(value + 2), false); }}>A＋</button>
    {invalid || error ? <small role="alert">{error ?? "请输入正字号，例如 14 或 14pt"}</small> : null}
  </div>;
}
