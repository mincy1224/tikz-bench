import { useRef, useState } from "react";
import { applyEditAction } from "tikz-editor/edit/actions";
import { buildArrowTipSizeMutation, type ArrowSizeKey, type ArrowTipWriteTarget } from "tikz-editor/edit/property-write-builders";
import type { ArrowTipSide } from "tikz-editor/edit/inspector";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { usePropertyEditSession } from "./usePropertyEditSession";
import css from "./InspectorPanel.module.css";

export function ArrowSizeEditor({ writes, side }: { writes: readonly ArrowTipWriteTarget[]; side: ArrowTipSide }) {
  const editable = writes.filter((write) => write.writable && (side === "start" ? write.arrowContext.startRaw : write.arrowContext.endRaw).trim());
  const key = `${side}:${writes.map((write) => write.elementId).join(",")}`;
  const { update, cancel, commitPreview, error } = usePropertyEditSession(key);
  const [drafts, setDrafts] = useState<Partial<Record<ArrowSizeKey, string>>>({});
  const skipBlur = useRef(false);
  if (!editable.length) return null;
  const rawValue = (name: ArrowSizeKey): string => {
    const values = editable.map((write) => {
      const raw = side === "start" ? write.arrowContext.startRaw : write.arrowContext.endRaw;
      return new RegExp(`(?:\\[|,)\\s*${name}\\s*=\\s*([^,\\]]+)`, "u").exec(raw)?.[1]?.trim() ?? "";
    });
    return values.every((value) => value === values[0]) ? values[0] ?? "" : "多个值";
  };
  const change = (name: ArrowSizeKey, raw: string, preview: boolean) => {
    let value = raw.trim();
    if (value) {
      const number = name === "scale" ? Number(value) : parseLength(value, "pt");
      if (number == null || !Number.isFinite(number) || number <= 0) return;
      value = `${number}${name === "scale" ? "" : "pt"}`;
    }
    update((source) => {
      let next = source;
      for (const write of editable) {
        const mutation = buildArrowTipSizeMutation(write.arrowContext, side, name, value);
        const result = applyEditAction(next, [], { kind: "setProperty", elementId: write.elementId, level: write.level, ...mutation });
        if (result.kind !== "success" && result.kind !== "partial") throw new Error("Arrow source is no longer editable");
        next = result.newSource;
      }
      return next;
    }, preview);
  };
  return <div className={css.sizeEditor}>
    {error ? <div role="alert" className={css.propertyNote}>{error}</div> : null}
    <label className={css.sizeRange}>大小倍率
      <input aria-label={`${side === "start" ? "起点" : "终点"}箭头大小倍率`} type="range" min="0.25" max="5" step="0.05"
        onBlur={commitPreview}
        value={Number(rawValue("scale")) || 1}
        onChange={(event) => { change("scale", event.target.value, true); }}
        onPointerUp={(event) => { change("scale", event.currentTarget.value, false); }}
        onPointerCancel={() => { cancel(); }}
        onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") change("scale", event.currentTarget.value, false); if (event.key === "Escape") cancel(); }} />
    </label>
    <div className={css.precisionGrid}>{(["scale", "length", "width"] as const).map((name) => <label key={name}>
      <span>{name === "scale" ? "倍率" : name === "length" ? "长度" : "宽度"}</span>
      <input aria-label={`${side}:${name}`} type="text" inputMode="decimal" placeholder={rawValue(name) === "多个值" ? "多个值" : "自动"}
        value={drafts[name] ?? (rawValue(name) === "多个值" ? "" : rawValue(name))}
        onChange={(event) => { setDrafts({ ...drafts, [name]: event.target.value }); }}
        onBlur={(event) => { if (!skipBlur.current && drafts[name] !== undefined) change(name, event.target.value, false); skipBlur.current = false; setDrafts({}); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { skipBlur.current = true; cancel(); setDrafts({}); event.currentTarget.blur(); } }} />
      <small>{name === "scale" ? "×" : "pt / mm / cm"}</small>
    </label>)}</div>
    <button type="button" className={css.moreOptionsToggle} onClick={() => { update((source) => {
      let next = source;
      for (const write of editable) {
          const mutation = buildArrowTipSizeMutation(write.arrowContext, side, "reset", "");
          const result = applyEditAction(next, [], { kind: "setProperty", elementId: write.elementId, level: write.level, ...mutation });
          if (result.kind === "success" || result.kind === "partial") next = result.newSource;
      }
      return next;
    }, false); setDrafts({}); }}>恢复箭头默认尺寸</button>
  </div>;
}
