import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const bash = process.platform === "win32" ? "D:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const posix = (value: string) => process.platform === "win32" ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll("\\", "/")}` : value;

describe("source installation entry point", () => {
  it("builds before deployment and never deploys a failed build", async () => {
    const workspace = process.cwd();
    const directory = await mkdtemp(path.join(workspace, ".install-build-fixture-"));
    const root = posix(directory);
    const put = async (relative: string, content: string) => {
      const file = path.join(directory, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { mode: 0o755 });
    };
    try {
      await put("install.sh", await readFile("install.sh", "utf8"));
      await put("package-lock.json", "{}");
      await put("package.json", '{"version":"0.5.2"}');
      await put("scripts/prepare-install.mjs", "// mocked staging; actual staging is checked separately\n");
      await put("mock/uname", "#!/bin/bash\necho Linux\n");
      await put("mock/ps", "#!/bin/bash\necho systemd\n");
      await put("mock/sudo", '#!/bin/bash\n[[ $1 == -v ]] && exit 0\nexec "$@"\n');
      await put("mock/git", "#!/bin/bash\necho fixture\n");
      for (const tool of ["sqlite3", "curl", "flock", "fc-list"]) await put(`mock/${tool}`, "#!/bin/bash\nexit 0\n");
      for (const tool of ["latex", "xelatex", "dvisvgm", "dvipdfmx", "kpsewhich"]) await put(`tex/${tool}`, "#!/bin/bash\nexit 0\n");
      await put("mock/node", `#!/bin/bash
if [[ $1 == scripts/prepare-install.mjs ]]; then
  printf '#!/bin/bash\\necho deployed > "$FIXTURE_ROOT/deployed"\\n' > "$2/install.sh"
elif [[ $1 == -p && $2 == process.platform ]]; then
  echo linux
elif [[ $1 == -e && \${OLD_NODE:-} == 1 ]]; then
  exit 1
else
  exec '${posix(process.execPath)}' "$@"
fi
`);
      await put("mock/npm", '#!/bin/bash\n[[ $PATH != *"/mnt/c/WindowsNode"* ]] || exit 98\n[[ $1 == --version ]] && { echo 10.9.4; exit 0; }\nprintf "%s\\n" "$*" >> "$FIXTURE_ROOT/build.log"\nif [[ ${FAIL_BUILD:-} == 1 && $1 == run ]]; then exit 42; fi\n');
      const run = (fail: boolean, old = false) => spawnSync(bash, ["-c", `export PATH='${root}/mock':/mnt/c/WindowsNode:$PATH FIXTURE_ROOT='${root}' TIKZ_TEX_BIN_DIR='${root}/tex' FAIL_BUILD=${fail ? 1 : 0} OLD_NODE=${old ? 1 : 0}; bash '${root}/install.sh'`], { encoding: "utf8", timeout: 30000 });
      const success = run(false);
      expect(success.status, success.stdout + success.stderr).toBe(0);
      expect(await readFile(path.join(directory, "build.log"), "utf8")).toBe("ci --include=dev\nrun build\nrun build:full\n");
      expect(await readFile(path.join(directory, "deployed"), "utf8")).toBe("deployed\n");
      await rm(path.join(directory, "deployed"));
      const failure = run(true);
      expect(failure.status).toBe(42);
      expect(await readdir(directory)).not.toContain("deployed");
      expect((await readdir(directory)).filter((file) => file.startsWith(".install-build-") && file !== ".install-build.lock")).toEqual([]);
      const before = await readFile(path.join(directory, "build.log"), "utf8");
      const unsupported = run(false, true);
      expect(unsupported.status).toBe(1);
      expect(unsupported.stderr).toContain("22.13+");
      expect(await readFile(path.join(directory, "build.log"), "utf8")).toBe(before);
    } finally {
      if (path.dirname(directory) !== workspace || !path.basename(directory).startsWith(".install-build-fixture-")) throw new Error("Unsafe cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
});
