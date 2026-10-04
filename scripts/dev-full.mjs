import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
const launchNpm = (args) => npmCli
  ? spawn(process.execPath, [npmCli, ...args], { stdio: "inherit", shell: false })
  : spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, { stdio: "inherit", shell: process.platform === "win32" });
const children = [
  launchNpm(["run", "dev:server", "--", "--port", "5174"]),
  launchNpm(["run", "dev:web", "--", "--host", "127.0.0.1"])
];

function stop() {
  for (const child of children) child.kill();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
for (const child of children) child.once("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
});
