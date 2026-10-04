import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ServerConfig } from "../config.js";

export type Project = {
  id: string;
  name: string;
  source: string;
  revision: number;
  thumbnailSvg: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const DEFAULT_SOURCE = "\\begin{tikzpicture}\n\n\\end{tikzpicture}\n";

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(config: ServerConfig, sql: string, json = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = json ? ["-json", config.databasePath] : [config.databasePath];
    const child = spawn(config.sqliteBin, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? 1}.`));
    });
    child.stdin.end(sql);
  });
}

type ProjectRow = {
  id: string;
  name: string;
  source: string;
  revision: number;
  thumbnail_svg: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function fromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    revision: row.revision,
    thumbnailSvg: row.thumbnail_svg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

async function rows(config: ServerConfig, sql: string): Promise<Project[]> {
  const output = await runSql(config, sql, true);
  if (!output.trim()) return [];
  return (JSON.parse(output) as ProjectRow[]).map(fromRow);
}

let writeQueue = Promise.resolve();
function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(() => {}, () => {});
  return next;
}

export async function initializeProjectStore(config: ServerConfig): Promise<void> {
  await mkdir(path.dirname(config.databasePath), { recursive: true });
  await runSql(config, `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  thumbnail_svg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS project_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON project_revisions(project_id, revision DESC);
`);
}

export function listProjects(config: ServerConfig, includeDeleted = false): Promise<Project[]> {
  return rows(config, `SELECT * FROM projects ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY updated_at DESC;`);
}

export async function getProject(config: ServerConfig, id: string): Promise<Project | null> {
  const result = await rows(config, `SELECT * FROM projects WHERE id=${quote(id)} LIMIT 1;`);
  return result[0] ?? null;
}

export function createProject(config: ServerConfig, name: string, source = DEFAULT_SOURCE): Promise<Project> {
  return serializeWrite(async () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await runSql(config, `INSERT INTO projects(id,name,source,revision,created_at,updated_at) VALUES(${quote(id)},${quote(name)},${quote(source)},1,${quote(now)},${quote(now)});`);
    return (await getProject(config, id))!;
  });
}

export function updateProject(config: ServerConfig, id: string, input: { name?: string; source?: string; expectedRevision?: number; thumbnailSvg?: string | null }): Promise<Project | "conflict" | null> {
  return serializeWrite(async () => {
    const current = await getProject(config, id);
    if (!current) return null;
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) return "conflict";
    const nextSource = input.source ?? current.source;
    const nextRevision = input.source === undefined ? current.revision : current.revision + 1;
    const now = new Date().toISOString();
    if (input.source !== undefined) {
      await runSql(config, `INSERT INTO project_revisions(project_id,revision,source,created_at) VALUES(${quote(id)},${current.revision},${quote(current.source)},${quote(now)});`);
    }
    await runSql(config, `UPDATE projects SET name=${quote(input.name ?? current.name)},source=${quote(nextSource)},revision=${nextRevision},thumbnail_svg=${input.thumbnailSvg === undefined ? "thumbnail_svg" : input.thumbnailSvg === null ? "NULL" : quote(input.thumbnailSvg)},updated_at=${quote(now)} WHERE id=${quote(id)};`);
    await runSql(config, `DELETE FROM project_revisions WHERE project_id=${quote(id)} AND id NOT IN (SELECT id FROM project_revisions WHERE project_id=${quote(id)} ORDER BY revision DESC LIMIT 30);`);
    return await getProject(config, id);
  });
}

export function softDeleteProject(config: ServerConfig, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const project = await getProject(config, id);
    if (!project) return false;
    const now = new Date().toISOString();
    await runSql(config, `UPDATE projects SET deleted_at=${quote(now)},updated_at=${quote(now)} WHERE id=${quote(id)};`);
    return true;
  });
}
