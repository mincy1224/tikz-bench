import { Component, type ReactNode } from "react";
import { useEditorStore } from "../store/store";

export class EditorRecovery extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" style={{ padding: 24, color: "var(--text)", background: "var(--bg-pane)" }}><h2>编辑器遇到错误，源码已保留</h2><pre>{this.state.error}</pre><button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([useEditorStore.getState().source], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tikz-draft.tex"; anchor.click(); URL.revokeObjectURL(url);
    }}>下载源码</button><button type="button" onClick={() => { this.setState({ error: null }); }}>重试界面</button></div>;
  }
}
