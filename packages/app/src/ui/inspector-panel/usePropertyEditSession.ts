import { useCallback, useEffect, useRef, useState } from "react";
import { SourceEditTransaction } from "../../store/source-edit-transaction";

/** All scalar, color and arrow editors use the same source transaction. */
export function usePropertyEditSession(targetKey: string) {
  const [error, setError] = useState<string | null>(null);
  const session = useRef<SourceEditTransaction | null>(null);
  const cancel = useCallback(() => { session.current?.finish(true); session.current = null; }, []);
  useEffect(() => cancel, [cancel, targetKey]);
  const update = useCallback((build: (source: string) => string, preview: boolean) => {
    session.current ??= new SourceEditTransaction("修改格式");
    try {
      if (!session.current.preview(build)) throw new Error("源码已改变，请重新选择对象。");
      setError(null);
      if (!preview) { session.current.finish(); session.current = null; }
    } catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); }
  }, []);
  const previewMutation = useCallback((apply: () => void) => {
    session.current ??= new SourceEditTransaction("修改格式");
    if (!session.current.previewMutation(apply)) { session.current = null; setError("源码已改变，请重新选择对象。"); }
  }, []);
  const commitPreview = useCallback(() => { session.current?.finish(); session.current = null; }, []);
  return { update, cancel, error, previewMutation, commitPreview };
}
