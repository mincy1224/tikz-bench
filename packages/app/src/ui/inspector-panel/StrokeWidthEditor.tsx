import { useRef, useState } from "react";
import { applyEditAction } from "tikz-editor/edit/actions";
import type { SetPropertyWriteTarget } from "tikz-editor/edit/inspector";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { usePropertyEditSession } from "./usePropertyEditSession";
import css from "./InspectorPanel.module.css";

export function StrokeWidthEditor({ writes, value, mixed = false }: { writes: readonly SetPropertyWriteTarget[]; value: number; mixed?: boolean }) {
  const { update, cancel, commitPreview, error } = usePropertyEditSession(`stroke:${writes.map((write) => write.elementId).join(",")}`);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const skipBlur = useRef(false);
  const writable = writes.some((write) => write.writable);
  const change = (raw: string, preview: boolean) => {
    const width = parseLength(raw.trim(), "pt");
    if (width == null || !Number.isFinite(width) || width < 0) { setInvalid(true); if (!preview) cancel(); return; }
    setInvalid(false);
    update((source) => {
      let next = source;
      for (const write of writes) {
        if (!write.writable) continue;
        const result = applyEditAction(next, [], { kind: "setProperty", elementId: write.elementId, level: write.level, key: "line width", propertyId: "line-width", value: `${width}pt` });
        if (result.kind !== "success" && result.kind !== "partial") throw new Error("线条目标已变化，请重新选择。");
        next = result.newSource;
      }
      return next;
    }, preview);
  };
  return <div className={css.strokePrecision}>
    <label>线宽 <input aria-label="线宽（pt / mm / cm）" inputMode="decimal" disabled={!writable} aria-invalid={invalid}
      placeholder={mixed ? "多个值" : "0.4"} value={draft ?? (mixed ? "" : String(Math.round(value * 1000) / 1000))}
      onChange={(event) => { setDraft(event.target.value); change(event.target.value, true); }}
      onBlur={(event) => { if (!skipBlur.current && draft !== null) change(event.target.value, false); skipBlur.current = false; setDraft(null); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); skipBlur.current = true; cancel(); setDraft(null); event.currentTarget.blur(); } }}
    /><span>pt</span></label>
    <input type="range" aria-label="线宽滑块" disabled={!writable} min={0} max={Math.max(8, value)} step={0.05} value={value}
      onBlur={commitPreview}
      onChange={(event) => { change(event.target.value, true); }} onPointerUp={(event) => { change(event.currentTarget.value, false); }}
      onPointerCancel={() => { cancel(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}
      onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") change(event.currentTarget.value, false); }} />
    {invalid || error ? <small role="alert">{error ?? "请输入非负线宽，例如 1.5pt 或 0.5mm"}</small> : null}
  </div>;
}
