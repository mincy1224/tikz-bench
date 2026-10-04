#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
[[ $EUID == 0 ]] || { echo '需要管理员权限' >&2; exit 1; }
exec 9>/run/lock/tikz-bench-upgrade.lock
flock -n 9 || { echo '另一项升级、备份或回滚正在运行' >&2; exit 1; }
active=0
systemctl is-active --quiet tikz-bench.service && active=1
if [[ ${1:-} == backup ]]; then
  destination=${2:?}; owner=${3:?}
  [[ ! -e "$destination" && "$destination" != *"'"* ]] || exit 1
  trap 'if [[ $active == 1 ]]; then systemctl start tikz-bench.service; fi' EXIT
  systemctl stop tikz-bench.service
  database=/var/lib/tikz-bench/tikz-bench.sqlite
  configured=$(sed -n 's/^TIKZ_DATABASE_PATH=//p' /etc/default/tikz-bench | tail -n 1)
  [[ -z "$configured" ]] || database=${configured%\"}; database=${database#\"}
  sqlite3 "$database" ".backup '$destination'"
  chown "$owner" "$destination"
  chmod 0600 "$destination"
  echo "数据库已备份到：$destination"
  exit 0
fi
[[ ${1:-} == rollback ]] || exit 2
current=$(readlink -f /opt/tikz-bench/current)
previous=$(readlink -f /opt/tikz-bench/previous)
[[ "$previous" == /opt/tikz-bench/releases/* && -f "$previous/apps/server/dist/index.js" && "$current" != "$previous" ]] || { echo '没有可回滚的上一版' >&2; exit 1; }
success=0
restore() {
  code=$?
  if [[ $success == 0 ]]; then
    systemctl stop tikz-bench.service || true
    ln -sfn "$current" /opt/tikz-bench/.current-restore
    mv -Tf /opt/tikz-bench/.current-restore /opt/tikz-bench/current
    if [[ $active == 1 ]]; then systemctl start tikz-bench.service; fi
  fi
  exit "$code"
}
trap restore EXIT
systemctl stop tikz-bench.service
ln -sfn "$previous" /opt/tikz-bench/.current-new
mv -Tf /opt/tikz-bench/.current-new /opt/tikz-bench/current
systemctl start tikz-bench.service
port=$(sed -n 's/^TIKZ_SERVER_PORT=//p' /etc/default/tikz-bench | tail -n 1); port=${port:-5173}
healthy=0
for attempt in {1..30}; do
  if systemctl is-active --quiet tikz-bench.service && curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]] || { echo '回滚版本启动失败，恢复当前版本' >&2; exit 1; }
ln -sfn "$current" /opt/tikz-bench/previous
[[ $active == 1 ]] || systemctl stop tikz-bench.service
success=1
echo '已回滚程序；项目数据库保持不变。'
