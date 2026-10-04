import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { PlatformLatex } from "../platform/types";
import { sanitizeSvgMarkup } from "./svg-sanitize";
import { useSettingsStore } from "../settings/useSettingsStore";
import css from "./TikzJaxModal.module.css";

const TIKZJAX_ASSET_ROOT = "vendor/tikzjax/";
const NATIVE_COMPILE_TIMEOUT_MS = 22000;


type LibState = "idle" | "loading" | "loaded" | "error";

let _libState: LibState = "idle";
let _libPromise: Promise<void> | null = null;

function ensureTikzJaxLoaded(): Promise<void> {
  if (_libState === "loaded") return Promise.resolve();
  if (_libPromise) return _libPromise;

  _libState = "loading";
  _libPromise = new Promise<void>((resolve, reject) => {
    const assetRoot = new URL(TIKZJAX_ASSET_ROOT, document.baseURI);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("fonts.css", assetRoot).href;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = new URL("tikzjax.js", assetRoot).href;
    const timer = window.setTimeout(() => { script.onerror?.(new Event("error")); }, 10000);
    script.onload = () => {
      window.clearTimeout(timer);
      _libState = "loaded";
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      link.remove();
      _libState = "idle";
      _libPromise = null;
      reject(new Error("Failed to load the bundled TikZJax runtime"));
    };
    document.head.appendChild(script);
  });

  return _libPromise;
}

type Phase =
  | "checking-native"
  | "compiling-native"
  | "native-error"
  | "loading-lib"
  | "lib-error"
  | "rendering"
  | "done";

type TikzJaxModalProps = {
  source: string;
  activeFigureId: string | null;
  onClose: () => void;
  latex?: PlatformLatex;
  showOpenInNewTab?: boolean;
  showLogToggle?: boolean;
};

export function TikzJaxModal({
  source,
  activeFigureId,
  onClose,
  latex,
  showOpenInNewTab = true,
  showLogToggle = false
}: TikzJaxModalProps) {
  const previewMode = useSettingsStore((state) => state.settings.rendering.previewMode);
  const shouldTryLatex = previewMode !== "internal" && latex !== undefined;
  const [phase, setPhase] = useState<Phase>(shouldTryLatex ? "checking-native" : "loading-lib");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [nativeLog, setNativeLog] = useState<string>("");
  const [showLogView, setShowLogView] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const svgMarkupRef = useRef<string | null>(null);

  const renderSvgIntoOutput = (svg: string): void => {
    const safeSvg = sanitizeSvgMarkup(svg);
    svgMarkupRef.current = safeSvg;
    const output = outputRef.current;
    if (!output) {
      return;
    }
    output.innerHTML = safeSvg;
    const svgEl = output.querySelector("svg");
    if (svgEl) {
      svgEl.removeAttribute("width");
      svgEl.removeAttribute("height");
    }
  };

  // Try native LaTeX compilation if available
  useEffect(() => {
    if (!latex || previewMode === "internal") {
      setPhase("loading-lib");
      return;
    }
    let cancelled = false;
    setPhase("checking-native");
    let pollId: number | null = null;
    svgMarkupRef.current = null;
    setShowLogView(false);
    setNativeError(null);
    setNativeLog("Probing native LaTeX toolchain...");
    latex.checkAvailable().then((status) => {
      if (cancelled) return;
      const details = `Native LaTeX probe:\n${status.details}`;
      if (!status.available) {
        setNativeError("本地 LaTeX 编译服务不可用，请检查工具链或重试。");
        setNativeLog(details);
        const requiresFullTex = /\\begin\{(?:forest|axis|groupplot|circuitikz)\}|[\u3400-\u9fff]/u.test(source);
        setPhase(previewMode === "auto" && !requiresFullTex ? "loading-lib" : "native-error");
        return;
      }
      const prefix = `${details}\n\nStarting compilation...`;
      setNativeLog(prefix);
      setPhase("compiling-native");
      const latexDocument = source;
      const readLastCompileLog = latex.readLastCompileLog;
      if (typeof readLastCompileLog === "function") {
        pollId = window.setInterval(() => {
          void readLastCompileLog().then((logText) => {
            if (cancelled) {
              return;
            }
            if (!logText) {
              return;
            }
            setNativeLog(`${prefix}\n\n--- input.log ---\n${logText}`);
          }).catch(() => {
            // Ignore log polling failures; compile result path remains authoritative.
          });
        }, 120);
      }
      const compilePromise = latex.compileTikzToSvg(latexDocument);
      const timeoutPromise = new Promise<string>((_resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error(`Native compile did not return within ${NATIVE_COMPILE_TIMEOUT_MS}ms.`));
        }, NATIVE_COMPILE_TIMEOUT_MS);
        void compilePromise.then(() => { window.clearTimeout(timeoutId); }, () => { window.clearTimeout(timeoutId); });
      });
      return Promise.race([compilePromise, timeoutPromise]).then((svg) => {
        if (cancelled) return;
        setShowLogView(false);
        if (pollId != null) {
          window.clearInterval(pollId);
        }
        renderSvgIntoOutput(svg);
        setPhase("done");
      });
    }).catch((error) => {
      if (cancelled) return;
      if (pollId != null) {
        window.clearInterval(pollId);
      }
      const message = String(error);
      setNativeError(message);
      const readLastCompileLog = latex.readLastCompileLog;
      if (typeof readLastCompileLog === "function") {
        void readLastCompileLog().then((logText) => {
          if (!cancelled) setNativeLog(logText || message);
        }).catch(() => { setNativeLog(message); });
      } else {
        setNativeLog(message);
      }
      setPhase("native-error");
    });
    return () => {
      cancelled = true;
      if (pollId != null) {
        window.clearInterval(pollId);
      }
    };
  }, [activeFigureId, latex, previewMode, retryToken, source]);

  // TikZJax fallback path
  useEffect(() => {
    if (phase !== "loading-lib") return;
    ensureTikzJaxLoaded().then(
      () => { setPhase("rendering"); },
      () => { setPhase("lib-error"); }
    );
  }, [phase]);

  // Trigger TikZJax rendering once the library is ready
  useEffect(() => {
    if (phase !== "rendering") return;
    const output = outputRef.current;
    if (!output) return;

    output.innerHTML = "";

    const tikzScript = document.createElement("script");
    tikzScript.type = "text/tikz";
    tikzScript.textContent = source;

    const container = document.createElement("div");
    container.appendChild(tikzScript);
    output.appendChild(container);

    const onFinished = (e: Event) => {
      if (output.contains(e.target as Node)) {
        const svg = output.querySelector("svg");
        if (svg) {
          renderSvgIntoOutput(svg.outerHTML);
          setPhase("done");
        } else {
          setNativeError("编译结束但未返回 SVG，请重试或使用本地 TeX 编译。");
          setPhase("lib-error");
        }
        document.removeEventListener("tikzjax-load-finished", onFinished);
      }
    };
    document.addEventListener("tikzjax-load-finished", onFinished);
    const timer = window.setTimeout(() => {
      setNativeError("浏览器 TeX 编译超时；复杂代码建议使用本地 TeX 编译。");
      setPhase("lib-error");
    }, 25000);

    return () => {
      document.removeEventListener("tikzjax-load-finished", onFinished);
      window.clearTimeout(timer);
    };
  }, [phase, source]);

  // Show progress/errors inside the same output panel while native compile is running/failing.
  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    if (phase === "done" || phase === "rendering" || phase === "loading-lib") return;
    const pre = document.createElement("pre");
    pre.className = css.outputLog;
    pre.textContent = nativeLog.length > 0 ? nativeLog : nativeError !== null && nativeError.length > 0 ? nativeError : "No diagnostic output.";
    output.innerHTML = "";
    output.appendChild(pre);
    pre.scrollTop = pre.scrollHeight;
  }, [nativeError, nativeLog, phase]);

  useEffect(() => {
    if (phase !== "done") return;
    const output = outputRef.current;
    if (!output) return;
    if (showLogView) {
      const pre = document.createElement("pre");
      pre.className = css.outputLog;
      pre.textContent = nativeLog || "No diagnostic output.";
      output.innerHTML = "";
      output.appendChild(pre);
      pre.scrollTop = pre.scrollHeight;
      return;
    }
    const svg = svgMarkupRef.current;
    if (svg) {
      renderSvgIntoOutput(svg);
    }
  }, [nativeLog, phase, showLogView]);

  const statusText =
    phase === "checking-native" ? "检查本地 LaTeX 工具链…" :
    phase === "compiling-native" ? "正在编译当前草稿…" :
    phase === "loading-lib" ? "Loading TikZJax…" :
    phase === "lib-error" ? "Failed to load the bundled TikZJax runtime." :
    phase === "native-error" ? "本地 LaTeX 编译失败，可查看诊断并重试。" :
    phase === "rendering" ? "Compiling…" :
    null;

  const downloadSvg = () => {
    const svg = outputRef.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tikz.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openInNewTab = () => {
    const svg = outputRef.current?.querySelector("svg");
    if (!svg) return;
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff}svg{width:auto;height:auto;max-width:90vw;max-height:90vh}</style>
</head><body>${svg.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <Modal
      variant="panel"
      onClose={onClose}
      labelledBy="tikzjax-title"
      draggable
      resizable
      closeOnBackdrop
      initialWidth={760}
      initialHeight={560}
      className={css.dialog}
    >
      <Modal.Header
        title="LaTeX 编译预览"
        titleId="tikzjax-title"
        draggable
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close compiled picture"
      />

      {statusText ? (
        <div className={css.statusBar} data-select="text">
          <span>{statusText}</span>
          <span className={css.modeBadge}>
            {previewMode === "internal" ? "TikZJax" : previewMode === "latex" ? "WSL LaTeX" : "Auto"}
          </span>
        </div>
      ) : null}

      {phase === "native-error" || phase === "lib-error" ? (
        <div className={css.fallbackRow}>
          {latex ? <Modal.SecondaryButton onClick={() => { setRetryToken((token) => token + 1); }}>重新编译当前草稿</Modal.SecondaryButton> : null}
          <Modal.SecondaryButton onClick={() => { setPhase("loading-lib"); }}>
            尝试浏览器 TeX（功能有限）
          </Modal.SecondaryButton>
        </div>
      ) : null}

      <Modal.Body padding="none">
        <div className={css.output} ref={outputRef} />
      </Modal.Body>

      <Modal.Footer align="between">
        <div className={css.footerLeft}>
          {showLogToggle && phase === "done" && nativeLog.trim().length > 0 ? (
            <Modal.GhostButton onClick={() => { setShowLogView((prev) => !prev); }}>
              {showLogView ? "Show Image" : "Show Log"}
            </Modal.GhostButton>
          ) : null}
        </div>
        <div className={css.footerRight}>
          {showOpenInNewTab ? (
            <Modal.SecondaryButton disabled={phase !== "done"} onClick={openInNewTab}>
              Open in New Tab
            </Modal.SecondaryButton>
          ) : null}
          <Modal.PrimaryButton disabled={phase !== "done"} onClick={downloadSvg}>
            Download SVG
          </Modal.PrimaryButton>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
