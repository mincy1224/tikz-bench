#!/usr/bin/env bash
set -euo pipefail
export SYSTEMD_PAGER=cat
case "${1:-}" in
  start) sudo systemctl start tikz-bench.service; echo 'TikZ Bench 已启动。' ;;
  status) systemctl status tikz-bench.service --no-pager ;;
  stop) sudo systemctl stop tikz-bench.service; echo 'TikZ Bench 已停止。' ;;
  restart) sudo systemctl restart tikz-bench.service; echo 'TikZ Bench 已重新启动。' ;;
  logs) journalctl -u tikz-bench.service -n 100 --no-pager ;;
  version) node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("/opt/tikz-bench/current/manifest.json","utf8"));console.log("TikZ Bench "+m.version)' ;;
  backup)
    destination=$(realpath -m -- "${2:-$PWD/tikz-bench-backup-$(date +%Y%m%d-%H%M%S).sqlite}")
    [[ ! -e "$destination" && "$destination" != *"'"* ]] || { echo '备份目标已存在或文件名包含单引号' >&2; exit 1; }
    sudo bash /opt/tikz-bench/current/scripts/manage-release.sh backup "$destination" "$(id -u):$(id -g)"
    ;;
  upgrade)
    source_dir=$(realpath -- "${2:-$PWD}")
    [[ -f "$source_dir/install.sh" && -f "$source_dir/package-lock.json" ]] || { echo "请指定 TikZ Bench 源码目录" >&2; exit 1; }
    exec bash "$source_dir/install.sh"
    ;;
  rollback) sudo bash /opt/tikz-bench/current/scripts/manage-release.sh rollback ;;
  *) echo '用法：tikz-bench {start|status|stop|restart|logs|backup [文件]|version|upgrade [源码目录]|rollback}' >&2; exit 2 ;;
esac
