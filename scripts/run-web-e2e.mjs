import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [browsers = "chromium", ...args] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const child = spawn(process.execPath, [cli, "test", ...args], {
  cwd: path.join(root, "apps", "web"),
  stdio: "inherit",
  shell: false,
  env: { ...process.env, PLAYWRIGHT_BROWSERS: browsers, FORCE_COLOR: "0" }
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
