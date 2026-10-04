#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [[ ! -f "$source_dir/manifest.json" ]]; then source_dir=$(CDPATH= cd -- "$source_dir/.." && pwd); fi
tex_dir=${TIKZ_TEX_BIN_DIR:-}
if [[ -z "$tex_dir" ]] && command -v latex >/dev/null; then tex_dir=$(dirname "$(command -v latex)"); fi
if [[ $EUID -ne 0 ]]; then exec sudo env TIKZ_TEX_BIN_DIR="$tex_dir" bash "$source_dir/install.sh"; fi
[[ -f "$source_dir/SHA256SUMS" && -f "$source_dir/manifest.json" ]] || { echo '安装包缺少版本清单或校验文件' >&2; exit 1; }
(cd "$source_dir" && sha256sum --strict --check SHA256SUMS >/dev/null)
command -v systemctl >/dev/null || { echo '需要启用 systemd' >&2; exit 1; }
[[ $(ps -p 1 -o comm=) == systemd ]] || { echo 'systemd 未运行，请先在 WSL 中启用它' >&2; exit 1; }
missing=()
for pair in 'node:nodejs' 'sqlite3:sqlite3' 'curl:curl' 'flock:util-linux' 'fc-list:fontconfig'; do
  command -v "${pair%%:*}" >/dev/null || missing+=("${pair#*:}")
done
if ((${#missing[@]})); then apt-get update; apt-get install -y "${missing[@]}"; fi
node -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)' || { echo '需要 Node.js 18 或更高版本' >&2; exit 1; }
version=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(m.schema!==1||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version))process.exit(1);process.stdout.write(m.version)' "$source_dir/manifest.json")
install -d -m 0755 /opt/tikz-bench/releases /var/backups/tikz-bench /run/lock
exec 9>/run/lock/tikz-bench-upgrade.lock
flock -n 9 || { echo '另一项升级或回滚正在运行' >&2; exit 1; }
if [[ -z "$tex_dir" || ! -x "$tex_dir/xelatex" ]]; then
  tex_dir=$(find /usr/local/texlive -maxdepth 4 -type f -name dvisvgm 2>/dev/null | sort -Vr | head -n 1 | xargs -r dirname)
fi
[[ -x "$tex_dir/latex" && -x "$tex_dir/xelatex" ]] || { echo '未找到现有 TeX Live；用 TIKZ_TEX_BIN_DIR 指定其 bin 目录。不会自动安装 TeX。' >&2; exit 1; }
if ! fc-list :lang=zh | grep -q .; then apt-get update; apt-get install -y fonts-noto-cjk; fi
release=/opt/tikz-bench/releases/$version
if [[ -d "$release" ]]; then
  cmp "$source_dir/SHA256SUMS" "$release/SHA256SUMS" || { echo '同版本安装内容不同，请使用新版本号' >&2; exit 1; }
else
  stage=$(mktemp -d /opt/tikz-bench/releases/.staging-XXXXXX)
  cp -a "$source_dir/." "$stage/"
  (cd "$stage" && sha256sum --strict --check SHA256SUMS >/dev/null)
  chmod 0755 "$stage"
  mv "$stage" "$release"
fi
chmod 0755 "$release"
stamp=$(date +%Y%m%d-%H%M%S)-$$
backup=/var/backups/tikz-bench/$stamp
install -d -m 0700 "$backup"
active=0; enabled=0
systemctl is-active --quiet tikz-bench.service && active=1
systemctl is-enabled --quiet tikz-bench.service && enabled=1
for item in /etc/default/tikz-bench /etc/systemd/system/tikz-bench.service /usr/local/bin/tikz-bench; do
  [[ ! -f "$item" ]] || cp -a "$item" "$backup/$(basename "$item")"
done
old=$(readlink -f /opt/tikz-bench/current || true)
if [[ ! -f "$old/apps/server/dist/index.js" && -f /opt/tikz-bench/apps/server/dist/index.js ]]; then
  old=/opt/tikz-bench/releases/legacy-$stamp
  install -d "$old"
  cp -a /opt/tikz-bench/apps "$old/apps"
fi
switched=0; success=0
restore() {
  code=$?
  if [[ $success == 0 ]]; then
    echo '安装未通过验证，正在恢复旧程序与配置。' >&2
    systemctl stop tikz-bench.service || true
    if [[ -n "$old" && -d "$old" ]]; then
      ln -sfn "$old" /opt/tikz-bench/.current-restore
      mv -Tf /opt/tikz-bench/.current-restore /opt/tikz-bench/current
    elif [[ $switched == 1 && -L /opt/tikz-bench/current ]]; then
      rm -f /opt/tikz-bench/current
    fi
    for item in /etc/default/tikz-bench /etc/systemd/system/tikz-bench.service /usr/local/bin/tikz-bench; do
      if [[ -f "$backup/$(basename "$item")" ]]; then cp -a "$backup/$(basename "$item")" "$item"; elif [[ $switched == 1 ]]; then rm -f "$item"; fi
    done
    systemctl daemon-reload
    if [[ $enabled == 1 ]]; then systemctl enable tikz-bench.service >/dev/null 2>&1 || true; else systemctl disable tikz-bench.service >/dev/null 2>&1 || true; fi
    if [[ $active == 1 ]]; then systemctl start tikz-bench.service || true; fi
  fi
  exit "$code"
}
trap restore EXIT
install -d /etc/default
if [[ ! -f /etc/default/tikz-bench ]]; then printf '%s\n' 'TIKZ_SERVER_HOST=127.0.0.1' 'TIKZ_SERVER_PORT=5173' > /etc/default/tikz-bench; fi
if ! grep -q '^PATH=' /etc/default/tikz-bench; then printf '\nPATH=%s:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' "$tex_dir" >> /etc/default/tikz-bench; fi
# Validate the actual service isolation and EnvironmentFile before switching.
systemd-run --quiet --wait --pipe --collect --unit="tikz-bench-preflight-$stamp" \
  -p DynamicUser=yes -p User=tikz-bench -p Group=tikz-bench -p StateDirectory=tikz-bench -p ProtectHome=yes -p ProtectSystem=strict \
  -p PrivateTmp=yes -p PrivateDevices=yes -p NoNewPrivileges=yes \
  -p ProtectKernelTunables=yes -p ProtectKernelModules=yes -p ProtectControlGroups=yes \
  -p RestrictSUIDSGID=yes -p LockPersonality=yes -p MemoryMax=1G -p TasksMax=128 \
  -p "WorkingDirectory=$release" -p Environment=HOME=/var/lib/tikz-bench \
  -p EnvironmentFile=/etc/default/tikz-bench /usr/bin/node "$release/scripts/verify-runtime.mjs"
systemctl stop tikz-bench.service || true
database=/var/lib/tikz-bench/tikz-bench.sqlite
configured_db=$(sed -n 's/^TIKZ_DATABASE_PATH=//p' /etc/default/tikz-bench | tail -n 1)
[[ -z "$configured_db" ]] || database=${configured_db%\"}; database=${database#\"}
if [[ -f "$database" ]]; then sqlite3 "$database" ".backup '$backup/projects.sqlite'"; fi
switched=1
ln -sfn "$release" /opt/tikz-bench/.current-new
mv -Tf /opt/tikz-bench/.current-new /opt/tikz-bench/current
install -m 0644 "$release/scripts/tikz-bench.service" /etc/systemd/system/tikz-bench.service
install -m 0755 "$release/scripts/tikz-bench" /usr/local/bin/tikz-bench
systemctl daemon-reload
systemctl enable tikz-bench.service >/dev/null
systemctl start tikz-bench.service
port=$(sed -n 's/^TIKZ_SERVER_PORT=//p' /etc/default/tikz-bench | tail -n 1); port=${port:-5173}
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet tikz-bench.service && curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]] || { echo '新版服务健康检查失败' >&2; exit 1; }
if [[ -n "$old" && "$old" != "$release" && -d "$old" ]]; then ln -sfn "$old" /opt/tikz-bench/previous; fi
if [[ $active == 0 && -f "$backup/tikz-bench.service" ]]; then systemctl stop tikz-bench.service; fi
if [[ $enabled == 0 && -f "$backup/tikz-bench.service" ]]; then systemctl disable tikz-bench.service >/dev/null; fi
success=1
previous=$(readlink -f /opt/tikz-bench/previous || true)
while IFS= read -r -d '' candidate; do
  name=${candidate##*/}
  if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && "$candidate" != "$release" && "$candidate" != "$previous" && ! -L "$candidate" && "$(readlink -f "$candidate")" == "$candidate" ]]; then
    rm -rf -- "$candidate"
  fi
done < <(find /opt/tikz-bench/releases -mindepth 1 -maxdepth 1 -type d -print0)
echo "TikZ Bench $version 安装成功；配置和项目数据已保留。备份：$backup"
