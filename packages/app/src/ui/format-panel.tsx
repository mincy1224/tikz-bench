import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { editableObjects, fontWithSize, setObjectProperty, tikzColor, type EditableObject } from "tikz-editor/edit/editable-objects";
import { advancedObject, editForestStructure, setAdvancedContent } from "tikz-editor/edit/advanced-objects";
import { applyEditAction, type EditAction } from "tikz-editor/edit/actions";
import { getEditableNodeParts, nodePartProperty, updateNodePart, updateNodePartFill } from "tikz-editor/edit/multipart";
import { getInspectorDescriptor } from "tikz-editor/edit/inspector";
import { buildArrowTipSetPropertyMutation } from "tikz-editor/edit/property-write-builders";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { useEditorStore } from "../store/store";
import { SourceEditTransaction } from "../store/source-edit-transaction";
import { SidePanel } from "./SidePanel";
import { ColorPickerField } from "./ColorPicker";
import { ArrowSizeEditor } from "./inspector-panel/ArrowSizeEditor";
import { useResizePreference } from "./resize-preference";
import { useFormatPainter } from "./format-painter";
import css from "./format-panel.module.css";

function Section({ title, children, advanced = false }: { title: string; children: ReactNode; advanced?: boolean }) {
  return advanced ? <details className={css.section}><summary>{title}</summary>{children}</details> : <section className={css.section}><h3>{title}</h3>{children}</section>;
}

function ColorField({ label, value, write }: { label: string; value: string | null; write: (source: string, value: string) => string }) {
  const transaction = useRef<SourceEditTransaction | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { transaction.current?.finish(true); }, []);
  const preview = (color: string) => {
    transaction.current ??= new SourceEditTransaction(label);
    try { transaction.current.preview((base) => write(base, tikzColor(color))); setError(""); }
    catch (error_) { setError(String(error_)); }
  };
  const finish = (cancel: boolean) => { transaction.current?.finish(cancel || Boolean(error)); transaction.current = null; };
  return <div className={css.field}><span>{label}</span><ColorPickerField ariaLabel={label} options={["none", "black", "white", "red", "orange", "yellow", "green", "blue", "violet", "gray"]} value={value} syntaxValue={value} mixed={value === null}
    onPreview={preview} onChange={(color) => { preview(color); finish(false); }} onCommit={() => { finish(false); }} onCancel={() => { finish(true); }} />{error ? <small role="alert">{error}</small> : null}</div>;
}

/** Draft input owns its transaction; IME text is never parsed mid-composition. */
function Field({ label, value, write, unit, multiline = false, allowNegative = false }: { label: string; value: string | null; write: (source: string, value: string) => string; unit?: string; multiline?: boolean; allowNegative?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const transaction = useRef<SourceEditTransaction | null>(null);
  const composing = useRef(false); const cancelled = useRef(false);
  useEffect(() => () => { transaction.current?.finish(true); }, []);
  const preview = (raw: string) => {
    transaction.current ??= new SourceEditTransaction(label);
    try {
      let next = raw;
      if (unit && raw.trim()) {
        const length = parseLength(raw, "pt");
        if (length == null || !Number.isFinite(length) || !allowNegative && length < 0) throw new Error("请输入有效数值，可使用 pt、mm、cm 或 in。");
        next = `${length}pt`;
      }
      if (!transaction.current.preview((base) => write(base, next))) throw new Error("源码已改变，请重新选择对象。");
      setError("");
    } catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
  };
  const props = {
    "aria-label": label, value: draft ?? value ?? "", placeholder: value === null ? "多个值" : "继承／默认",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const raw = event.target.value; setDraft(raw); if (!composing.current) preview(raw); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; preview(event.currentTarget.value); },
    onBlur: () => { transaction.current?.finish(cancelled.current || Boolean(error)); transaction.current = null; cancelled.current = false; setDraft(null); setError(""); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (unit && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        const current = parseLength(event.currentTarget.value || "0", "pt");
        if (current !== null) { const next = `${(allowNegative ? (current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)) : Math.max(0, current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)))}pt`; setDraft(next); preview(next); event.preventDefault(); }
        event.stopPropagation();
      }
      if (event.key === "Escape") { cancelled.current = true; event.currentTarget.blur(); event.stopPropagation(); }
      if (event.key === "Enter" && (!multiline || event.ctrlKey)) { event.currentTarget.blur(); event.preventDefault(); }
    }
  };
  return <label className={css.field}><span>{label}</span><div>{multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}{unit ? <small>{unit} · ↑↓ 步进</small> : null}{!multiline ? <button type="button" className={css.reset} aria-label={`${label}恢复默认`} title="移除局部设置，恢复继承或默认值" onClick={() => { preview(""); transaction.current?.finish(); transaction.current = null; setDraft(null); }}>恢复默认</button> : null}</div>{error ? <small role="alert">{error}</small> : null}</label>;
}

export function FormatPanel() {
  const state = useEditorStore();
  const resize = useResizePreference();
  const [alignToCanvas, setAlignToCanvas] = useState(false);
  const [tab, setTab] = useState<"shape" | "text">("shape"); const [error, setError] = useState("");
  const painterMessage = useFormatPainter((painter) => painter.message);
  const selected = useMemo(() => editableObjects(state.source, state.snapshot.scene?.elements, state.selectedElementIds, state.snapshot.parseResult), [state.source, state.snapshot.scene?.elements, state.selectedElementIds, state.snapshot.parseResult]);
  const key = `${state.activeDocumentId}:${selected.map((object) => object.id).join(",")}`;
  const single = selected.length === 1 ? selected[0] : null;
  const common = (property: string, fallback?: string): string | null => {
    const values = selected.map((object) => object.properties.get(property) ?? (fallback ? object.properties.get(fallback) : "") ?? "");
    return values.every((value) => value === values[0]) ? values[0] ?? "" : null;
  };
  const commit = (build: (source: string) => string, label: string) => {
    try { const transaction = new SourceEditTransaction(label); transaction.preview(build); transaction.finish(); setError(""); }
    catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
  };
  const property = (name: string, label: string, unit?: string, transform: (value: string, object: EditableObject) => string = (value) => value) =>
    ["fill", "draw", "text"].includes(name) ? <ColorField key={`${key}:${name}`} label={label} value={common(name, `resolved-${name}`)} write={(source, value) => selected.reduce((next, object) => setObjectProperty(next, object.id, name, transform(value, object)), source)} /> : <Field key={`${key}:${name}`} label={label} value={common(name, name === "line width" ? "resolved-line-width" : `resolved-${name}`)} unit={unit} allowNegative={name === "xshift" || name === "yshift"} write={(source, value) => selected.reduce((next, object) => setObjectProperty(next, object.id, name, transform(value, object)), source)} />;
  const action = (edit: EditAction) => { let selection: string[] | undefined; commit((source) => {
    const result = applyEditAction(source, state.snapshot.editHandles, edit, { parseOptions: { sourceFingerprint: state.snapshot.editHandles[0]?.sourceRef.sourceFingerprint, activeFigureId: state.activeFigureId } });
    if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
    selection = result.selectedSourceIds;
    return result.newSource;
  }, "排列"); if (selection) state.dispatch({ type: "SELECT_RANGE", ids: selection }); };
  const parts = useMemo(() => single ? getEditableNodeParts(state.source, single.id) : null, [state.source, single]);
  const descriptors = useMemo(() => selected.flatMap((object) => object.element ? [getInspectorDescriptor(object.element, { source: state.source, editHandles: state.snapshot.editHandles })] : []), [selected, state.source, state.snapshot.editHandles]);
  const allArrowFields = descriptors.flatMap((descriptor) => descriptor.sections.flatMap((section) => section.properties)).filter((property) => property.kind === "arrowTip");
  const arrowFields = allArrowFields.filter((field, index) => allArrowFields.findIndex((candidate) => candidate.side === field.side) === index);
  return <SidePanel><SidePanel.Header>设置格式{selected.length ? ` · ${selected.length > 1 ? `${selected.length} 个对象` : single?.label}` : ""}</SidePanel.Header>
    <SidePanel.Content className={css.panel}>
      {painterMessage ? <p className={css.note} role="status">{painterMessage}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!selected.length ? <p className={css.note}>选择图形或组合以设置格式。拖动时显示边缘、中心和间距辅助线。</p> : <>
        <div className={css.tabs} role="tablist" aria-label="格式类别"><button type="button" role="tab" aria-selected={tab === "shape"} onClick={() => { setTab("shape"); }}>图形</button><button type="button" role="tab" aria-selected={tab === "text"} onClick={() => { setTab("text"); }}>文字</button></div>
        {tab === "shape" ? <>
          <Section title="填充">{property("fill", "填充颜色", undefined, tikzColor)}<div className={css.swatches}>{["none", "white", "black", "red!15", "blue!15", "green!15"].map((color) => <button type="button" key={color} onClick={() => { commit((source) => selected.reduce((next, object) => setObjectProperty(next, object.id, "fill", color), source), "填充"); }}>{({ none: "无填充", white: "白色", black: "黑色", "red!15": "浅红", "blue!15": "浅蓝", "green!15": "浅绿" } as Record<string, string>)[color]}</button>)}</div></Section>
          <Section title="线条">{property("draw", "线条颜色", undefined, tikzColor)}{property("line width", "线宽", "pt / mm / cm")}{property("dash pattern", "虚线模式")}
            {arrowFields.map((field) => field.kind === "arrowTip" ? <div key={field.side}><label className={css.field}><span>{field.side === "start" ? "起点箭头" : "终点箭头"}</span><select aria-label={field.label} value={allArrowFields.filter((candidate) => candidate.side === field.side).every((candidate) => candidate.value === field.value) ? field.value : "mixed"} onChange={(event) => { const preset = field.options.find((option) => option.value === event.target.value); if (!preset) return; commit((source) => allArrowFields.filter((candidate) => candidate.side === field.side).reduce((next, candidate) => {
                const result = applyEditAction(next, [], { kind: "setProperty", elementId: candidate.write.elementId, level: candidate.write.level, ...buildArrowTipSetPropertyMutation(candidate.write.arrowContext, field.side, preset.value) });
                if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
                return result.newSource;
              }, source), "箭头类型"); }}><option value="mixed" disabled>多个值</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><ArrowSizeEditor writes={allArrowFields.filter((candidate) => candidate.side === field.side).map((candidate) => candidate.write)} side={field.side} /></div> : null)}
          </Section>
          <Section title="尺寸与位置"><label className={css.field}><span>缩放方式</span><select aria-label="缩放方式" value={resize.whole ? "whole" : "geometry"} onChange={(event) => { resize.set(event.target.value === "whole"); }}><option value="geometry">仅改变尺寸</option><option value="whole">整体缩放</option></select></label>{property(single?.advanced?.family === "plot" ? "width" : "minimum width", "宽度约束", "pt / mm / cm")}{property(single?.advanced?.family === "plot" ? "height" : "minimum height", "高度约束", "pt / mm / cm")}{property("rotate", "旋转（度）")}{property("xshift", "水平偏移", "pt / mm / cm")}{property("yshift", "垂直偏移", "pt / mm / cm")}</Section>
          {selected.every((object) => !object.advanced) ? <Section title="排列"><label className={css.field}><span>对齐到</span><select aria-label="对齐到" value={alignToCanvas ? "canvas" : "selection"} onChange={(event) => { setAlignToCanvas(event.target.value === "canvas"); }}><option value="selection">选区</option><option value="canvas">画布</option></select></label><div className={css.buttons}>{(["left", "center", "right", "top", "middle", "bottom"] as const).map((mode, index) => <button type="button" key={mode} onClick={() => { action({ kind: "alignElements", elementIds: selected.map((object) => object.id), mode, referenceBounds: alignToCanvas ? state.snapshot.scene?.bounds : undefined }); }}>{["左对齐", "水平居中", "右对齐", "顶对齐", "垂直居中", "底对齐"][index]}</button>)}{(["x", "y"] as const).map((axis) => <button type="button" key={axis} onClick={() => { action({ kind: "distributeElements", elementIds: selected.map((object) => object.id), axis: axis === "x" ? "horizontal" : "vertical" }); }}>{axis === "x" ? "水平分布" : "垂直分布"}</button>)}<button type="button" onClick={() => { action({ kind: "groupElements", elementIds: selected.map((object) => object.id) }); }}>组合</button><button type="button" onClick={() => { action({ kind: "ungroupElements", elementIds: selected.map((object) => object.id) }); }}>取消组合</button></div></Section> : null}
        </> : <>
          <Section title="文本">{parts ? <p className={css.note}>请在下方分别编辑各分区文字。</p> : single?.advanced?.content ? <Field key={`${key}:content`} label="内容" value={single.properties.get("content") ?? ""} multiline write={(source, value) => setAdvancedContent(source, single.id, value)} /> : single?.element ? <Field key={`${key}:content`} label="内容" value={state.snapshot.scene?.elements.filter((element) => element.sourceRef.sourceId === single.id && element.kind === "Text").map((element) => element.kind === "Text" ? element.text : "").join("") ?? ""} multiline write={(source, value) => { const result = applyEditAction(source, [], { kind: "updateNodeText", elementId: single.id, text: value }); if (result.kind !== "success") throw new Error("此图形没有独立文本节点。"); return result.newSource; }} /> : null}
            <Field key={`${key}:size`} label="字号" value={common("resolved-size")} unit="pt / mm / cm" write={(source, value) => selected.reduce((next, object) => setObjectProperty(next, object.id, "font", value ? fontWithSize(object.properties.get("font") ?? "", value) : ""), source)} /><label className={css.field}><span>字体</span><select aria-label="字体" value={/\\ttfamily/u.test(common("font") ?? "") ? "mono" : /\\sffamily/u.test(common("font") ?? "") ? "sans" : "serif"} onChange={(event) => {
              const family = event.target.value;
              commit((source) => selected.reduce((next, object) => setObjectProperty(next, object.id, "font", (object.properties.get("font") ?? "").replace(/\\(?:rmfamily|sffamily|ttfamily)\b/gu, "") + (family === "mono" ? "\\ttfamily" : family === "sans" ? "\\sffamily" : "\\rmfamily")), source), "字体");
            }}><option value="serif">衬线 · Roman</option><option value="sans">无衬线 · Sans</option><option value="mono">等宽 · Mono</option></select></label><div className={css.buttons}>{(["bfseries", "itshape"] as const).map((command, index) => <button type="button" key={command} aria-pressed={new RegExp(`\\\\${command}\\b`, "u").test(common("font") ?? "")} onClick={() => {
              commit((source) => selected.reduce((next, object) => { const font = object.properties.get("font") ?? ""; const pattern = new RegExp(`\\\\${command}\\b`, "gu"); return setObjectProperty(next, object.id, "font", pattern.test(font) ? font.replace(pattern, "") : `${font}\\${command}`); }, source), "文字样式");
            }}>{index === 0 ? "粗体" : "斜体"}</button>)}</div><details><summary>字体高级命令</summary>{property("font", "字体命令")}</details>{property("text", "文字颜色", undefined, tikzColor)}{property("align", "段落对齐")}
          </Section><Section title="文本框">{property("inner xsep", "水平内边距", "pt / mm / cm")}{property("inner ysep", "垂直内边距", "pt / mm / cm")}{property("text width", "文本宽度", "pt / mm / cm")}</Section>
        </>}
        {parts ? <Section title="分区矩形"><label className={css.field}><span>排列方向</span><select aria-label="分区排列方向" value={common("rectangle split horizontal") === "true" ? "true" : "false"} onChange={(event) => { commit((source) => setObjectProperty(source, single!.id, "rectangle split horizontal", event.target.value), "分区排列"); }}><option value="true">横向</option><option value="false">纵向</option></select></label>{property("rectangle split parts", "分区数")}{Array.from({ length: parts.count }, (_, index) => <details key={`${key}:part:${index}`} open><summary>分区 {index + 1}</summary><Field label={`分区 ${index + 1} 内容`} multiline value={parts.parts.find((part) => part.logicalIndex === index)?.text ?? ""} write={(source, value) => updateNodePart(source, single!.id, index, "text", value)} /><ColorField label={`分区 ${index + 1} 填色`} value={nodePartProperty(state.source, single!.id, index, "fill")} write={(source, value) => updateNodePartFill(source, single!.id, index, tikzColor(value))} /><Field label={`分区 ${index + 1} 字体`} value={nodePartProperty(state.source, single!.id, index, "font")} write={(source, value) => updateNodePart(source, single!.id, index, "font", value)} /><Field label={`分区 ${index + 1} 对齐`} value={nodePartProperty(state.source, single!.id, index, "align")} write={(source, value) => updateNodePart(source, single!.id, index, "align", value)} /></details>)}</Section> : null}
        {single?.advanced ? <Section title={single.advanced.family === "forest" ? "树节点" : single.advanced.family === "circuit" ? "电路元件" : "图表"}>
          {(single.advanced.family === "forest" ? [["edge", "边样式"], ["l sep", "层级间距"], ["s sep", "同级间距"], ["rectangle split parts", "分区数"]] : single.advanced.family === "circuit" ? [["l", "标签"], ["invert", "反向（true / false）"], ["mirror", "镜像（true / false）"], ["v", "电压标注"], ["i", "电流标注"]] : single.type.startsWith("plot:") && single.advanced.parentId ? [["legend entry", "图例"], ["mark", "标记"], ["domain", "定义域"], ["samples", "采样数"], ["boxplot prepared", "箱线图参数"]] : [["title", "标题"], ["xlabel", "X 轴标签"], ["ylabel", "Y 轴标签"], ["xmin", "X 最小值"], ["xmax", "X 最大值"], ["ymin", "Y 最小值"], ["ymax", "Y 最大值"], ["xmode", "X 轴模式"], ["ymode", "Y 轴模式"], ["xtick", "X 刻度"], ["ytick", "Y 刻度"], ["legend entries", "图例条目"]]).map(([name, label]) => property(name, label))}
          {single.advanced.family === "forest" ? <div className={css.buttons}>{(["child", "sibling", "delete", "promote"] as const).map((operation, index) => <button type="button" key={operation} onClick={() => { commit((source) => editForestStructure(source, single.id, operation), "树结构"); if (operation === "delete" || operation === "promote") state.dispatch({ type: "CLEAR_SELECTION" }); }}>{["添加子节点", "添加同级", "删除子树", "删除并提升子节点"][index]}</button>)}</div> : null}
          {single.advanced.family === "plot" && single.advanced.parentId && single.advanced.content ? <Field key={`${key}:data`} label={single.advanced.data?.length ? "坐标数据" : "函数／表格参数"} multiline value={single.properties.get("content") ?? ""} write={(source, value) => setAdvancedContent(source, single.id, value)} /> : null}
          {single.advanced.endpoints?.map((span, index) => <Field key={`${key}:end:${index}`} label={`端点 ${index + 1}`} value={state.source.slice(span.from, span.to)} write={(source, value) => { const endpoint = advancedObject(source, single.id).endpoints?.[index]; if (!endpoint || !/^\([^;]+\)$/u.test(value)) throw new Error("端点格式为 (x,y) 或 (名称.锚点)。"); return source.slice(0, endpoint.from) + value + source.slice(endpoint.to); }} />)}
        </Section> : null}
        <Section title="效果" advanced>{property("opacity", "不透明度（0–1）")}{property("rounded corners", "圆角", "pt / mm / cm")}</Section>
      </>}
    </SidePanel.Content></SidePanel>;
}
