#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[[ -f "$root/package-lock.json" && -f "$root/scripts/prepare-install.mjs" ]] || { echo '请从完整源码仓库运行 install.sh' >&2; exit 1; }
[[ $(uname -s) == Linux && $(ps -p 1 -o comm=) == systemd ]] || { echo '需要 Linux 和运行中的 systemd；WSL2 请先启用 systemd。' >&2; exit 1; }
privileged() { if [[ $EUID == 0 ]]; then "$@"; else sudo "$@"; fi; }
if [[ $EUID != 0 ]]; then sudo -v; fi
missing=()
for pair in 'node:nodejs' 'npm:npm' 'sqlite3:sqlite3' 'curl:curl' 'flock:util-linux' 'fc-list:fontconfig'; do
  command -v "${pair%%:*}" >/dev/null || missing+=("${pair#*:}")
done
if ((${#missing[@]})); then privileged apt-get update; privileged apt-get install -y "${missing[@]}"; fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<18||(major===18&&minor<19))process.exit(1)' || { echo '源码构建需要 Node.js 18.19+（推荐 22+）；请更新 Node.js 后重试。' >&2; exit 1; }
tex_dir=${TIKZ_TEX_BIN_DIR:-}
if [[ -z "$tex_dir" ]] && command -v latex >/dev/null; then tex_dir=$(dirname "$(command -v latex)"); fi
if [[ -z "$tex_dir" || ! -x "$tex_dir/xelatex" ]]; then
  tex_dir=$(find /usr/local/texlive -maxdepth 4 -type f -name dvisvgm 2>/dev/null | sort -Vr | head -n 1 | xargs -r dirname) || true
fi
for tool in latex xelatex dvisvgm dvipdfmx kpsewhich; do
  [[ -x "$tex_dir/$tool" ]] || { echo "缺少 TeX 工具 $tool。请设置 TIKZ_TEX_BIN_DIR；安装器不会安装或替换 TeX。" >&2; exit 1; }
done
cd "$root"
exec 8>"$root/.install-build.lock"
flock -n 8 || { echo '该源码目录已有构建安装正在运行' >&2; exit 1; }
stage=$(mktemp -d "$root/.install-build-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
base=$(node -p 'JSON.parse(require("fs").readFileSync("package.json","utf8")).version')
revision=$(git rev-parse --short=12 HEAD 2>/dev/null || printf source)
version="$base-source.$revision.$(date -u +%Y%m%d%H%M%S).$$"
export TIKZ_RELEASE_VERSION="$version"
echo '正在安装构建依赖并从源码构建…'
npm ci --include=dev
npm run build
npm run build:full
node scripts/prepare-install.mjs "$stage" "$version"
TIKZ_TEX_BIN_DIR="$tex_dir" bash "$stage/install.sh"
