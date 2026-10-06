import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@tikz-editor/app";
import css from "./TikzBench.module.css";
import { COMPONENT_TEMPLATES } from "./component-templates";
import { ProjectDialog } from "./ProjectDialog";
import { CoalescingSaveQueue } from "./coalescing-save-queue";

type Project = {
  id: string;
  name: string;
  description: string;
  source: string;
  revision: number;
  thumbnailSvg: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const SAVE_HINT_DISABLED_KEY = "tikz-bench:hide-save-shortcut-hint";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed with HTTP ${response.status}.`);
  return payload;
}

function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function ProjectHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newProject, setNewProject] = useState<{ name: string; source?: string } | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    void api<{ projects: Project[] }>("/api/projects").then((result) => {
      setProjects(result.projects); setError(null);
    }).catch((error_: unknown) => { setError(error_ instanceof Error ? error_.message : String(error_)); })
      .finally(() => { setLoading(false); });
  }, []);
  useEffect(refresh, [refresh]);

  const create = async (name: string, description: string, source?: string) => {
    const result = await api<{ project: Project }>("/api/projects", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, source })
    });
    navigate(`/project/${result.project.id}`);
  };

  const rename = async (project: Project, name: string, description: string) => {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, expectedRevision: project.revision })
    });
    refresh();
  };

  return (
    <main className={css.home}>
      <header className={css.hero}>
        <div><div className={css.brandMark}>TB</div><div><h1>TikZ Bench</h1><p>Your local visual workspace for TikZ.</p></div></div>
        <div className={css.actions}>
          <input ref={fileInputRef} className={css.hiddenInput} type="file" accept=".tex,application/x-tex" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (!file.name.toLowerCase().endsWith(".tex")) {
              window.alert("Only .tex files can be imported.");
              return;
            }
            void file.text().then((source) => { setNewProject({ name: file.name.replace(/\.tex$/iu, ""), source }); }).catch((error_: unknown) => { setError(String(error_)); });
          }} />
          <button type="button" className={css.secondary} onClick={() => fileInputRef.current?.click()}>Import TeX</button>
          <button type="button" className={css.primary} onClick={() => { setNewProject({ name: "" }); }}>新建项目</button>
        </div>
      </header>
      <section className={css.content}>
        <div className={css.sectionHeading}><h2>从组件开始</h2><span>复杂组件使用本地 TeX 预览</span></div>
        <div className={css.templateGrid}>{COMPONENT_TEMPLATES.map((template) => <button key={template.name} type="button" className={css.templateCard} onClick={() => { setNewProject({ name: template.name, source: template.source }); }}>
          <small>{template.category}</small><strong>{template.name}</strong><span>{template.mode}</span>
        </button>)}</div>
        <div className={css.sectionHeading}><h2>Projects</h2><span>{projects.length} projects</span></div>
        {error ? <div className={css.error}>{error}</div> : null}
        {loading ? <div className={css.empty}>Loading projects…</div> : projects.length === 0 ? (
          <div className={css.empty}><h3>No projects yet</h3><p>Create a blank canvas or import an existing TeX file.</p></div>
        ) : (
          <div className={css.grid}>{projects.map((project) => (
            <article key={project.id} className={css.card} onClick={() => { navigate(`/project/${project.id}`); }}>
              <div className={css.preview}><span>\begin&#123;tikzpicture&#125;</span></div>
              <div className={css.cardBody}><div><h3>{project.name}</h3><time>{new Date(project.updatedAt).toLocaleString()}</time></div>
                <div className={css.cardActions}>
                <button type="button" title="Rename project" aria-label={`Rename ${project.name}`} onClick={(event) => {
                  event.stopPropagation(); setEditingProject(project);
                }}>✎</button>
                <button type="button" title="Delete project" onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`Move “${project.name}” to trash?`)) void api(`/api/projects/${project.id}`, { method: "DELETE" }).then(refresh);
                }}>×</button>
                </div>
              </div>
            </article>
          ))}</div>
        )}
      </section>
      <footer className={css.footer}>Based on the open-source TikZ Editor by Dominik Peters · MIT License</footer>
      {newProject ? <ProjectDialog name={newProject.name} onClose={() => { setNewProject(null); }} onSubmit={(name, description) => create(name, description, newProject.source)} /> : null}
      {editingProject ? <ProjectDialog name={editingProject.name} description={editingProject.description} onClose={() => { setEditingProject(null); }} onSubmit={(name, description) => rename(editingProject, name, description)} /> : null}
    </main>
  );
}

function ProjectEditor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [showSaveHint, setShowSaveHint] = useState(false);
  const revisionRef = useRef(0);
  const draftRef = useRef(draftSource);
  draftRef.current = draftSource;
  const [editInfo, setEditInfo] = useState(false);
  const [saveCopy, setSaveCopy] = useState(false);
  const saveQueue = useMemo(() => new CoalescingSaveQueue<{ source?: string; name?: string; description?: string; thumbnailSvg?: string }, Project>(async (patch) => {
      const { project: saved } = await api<{ project: Project }>(`/api/projects/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, expectedRevision: revisionRef.current })
      });
      revisionRef.current = saved.revision;
      setProject(saved);
      return saved;
  }), [id]);
  const persist = useCallback((patch: { source?: string; name?: string; description?: string; thumbnailSvg?: string }) => {
    setSaveStatus("saving");
    const task = saveQueue.enqueue(patch);
    void task.then((saved) => {
      if (!saveQueue.busy && saved.source === draftRef.current) setSaveStatus("saved");
    }).catch((error: unknown) => { setSaveStatus(error instanceof Error && error.message.includes("conflict") ? "conflict" : "error"); });
    return task;
  }, [saveQueue]);

  useEffect(() => {
    void api<{ project: Project }>(`/api/projects/${id}`).then(({ project: loaded }) => {
      setProject(loaded); setDraftSource(loaded.source); revisionRef.current = loaded.revision;
    }).catch(() => { navigate("/"); });
  }, [id]);

  useEffect(() => {
    if (!project || draftSource === project.source || saveStatus === "error" || saveStatus === "conflict") return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void persist({ source: draftSource }).catch(() => {});
    }, 700);
    return () => { window.clearTimeout(timer); };
  }, [draftSource, persist, project, saveStatus]);

  const download = useCallback(async (kind: "tex" | "pdf") => {
    const response = await fetch(`/api/projects/${id}/export/${kind}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: draftRef.current })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      window.alert(payload.error ?? `Export failed with HTTP ${response.status}.`);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project?.name ?? "tikz-project"}.${kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [id, project?.name]);

  const rename = useCallback(() => { setEditInfo(true); }, []);

  const onSaveShortcut = useCallback(() => {
    if (localStorage.getItem(SAVE_HINT_DISABLED_KEY) !== "1") setShowSaveHint(true);
  }, []);

  const projectProps = useMemo(() => project ? {
    id: project.id, name: project.name, source: project.source, saveStatus,
    onBack: () => { navigate("/"); }, onRename: rename, onSourceChange: setDraftSource,
    onSaveShortcut,
    onDownloadTex: () => { void download("tex"); }, onDownloadPdf: () => { void download("pdf"); }
  } : null, [download, onSaveShortcut, project, rename, saveStatus]);

  return projectProps ? <>
    <App project={projectProps} />
    {editInfo && project ? <ProjectDialog name={project.name} description={project.description} onClose={() => { setEditInfo(false); }} onSubmit={async (name, description) => { await persist({ name, description }); }} /> : null}
    {saveCopy && project ? <ProjectDialog name={`${project.name} draft`} description={project.description} onClose={() => { setSaveCopy(false); }} onSubmit={async (name, description) => {
      const response = await api<{ project: Project }>("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, source: draftRef.current }) });
      navigate(`/project/${response.project.id}`);
    }} /> : null}
    {saveStatus === "error" || saveStatus === "conflict" ? <aside className={css.saveHint} role="alert"><span>{saveStatus === "conflict" ? "其他窗口已更新项目，请另存草稿以保留双方内容。" : "草稿未保存"}</span><button type="button" onClick={() => { setSaveCopy(true); }}>另存草稿</button>{saveStatus === "error" ? <button type="button" onClick={() => { setSaveStatus("saving"); void persist({ source: draftRef.current }).catch(() => {}); }}>重试</button> : null}<button type="button" onClick={() => { void download("tex"); }}>下载草稿</button></aside> : null}
    {showSaveHint ? (
      <aside className={css.saveHint} role="status" aria-live="polite">
        <div><strong>Already saved automatically</strong><span>Ctrl+S is not needed in TikZ Bench.</span></div>
        <button type="button" onClick={() => {
          localStorage.setItem(SAVE_HINT_DISABLED_KEY, "1");
          setShowSaveHint(false);
        }}>Don’t show again</button>
        <button type="button" className={css.saveHintClose} aria-label="Dismiss" onClick={() => { setShowSaveHint(false); }}>×</button>
      </aside>
    ) : null}
  </> : <div className={css.editorLoading}>Loading TikZ Bench…</div>;
}

export function TikzBench() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => { setPath(window.location.pathname); };
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("popstate", update); };
  }, []);
  const match = /^\/project\/([0-9a-f-]+)$/iu.exec(path);
  return match ? <ProjectEditor key={match[1]} id={match[1] ?? ""} /> : <ProjectHome />;
}
