import { ColorPickerField, type ColorPickerProps } from "../ColorPicker";
import { usePropertyEditSession } from "./usePropertyEditSession";

export function InspectorColorPicker({ targetKey, onChange, ...props }: Omit<ColorPickerProps, "onChange"> & { targetKey: string; onChange: (value: string, recordInHistory: boolean) => void }) {
  const { previewMutation, commitPreview, cancel } = usePropertyEditSession(`color:${targetKey}`);
  return <ColorPickerField {...props} onChange={(value) => { onChange(value, true); }}
    onPreview={(value) => { previewMutation(() => { onChange(value, false); }); }}
    onCommit={commitPreview} onCancel={cancel} />;
}
