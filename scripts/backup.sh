#!/usr/bin/env bash
# 备份数据库到 ./backups，保留最近 7 天。
# 在服务器的项目目录里用 cron 每天跑一次：
#   0 4 * * * cd /srv/huoyaotong && ./scripts/backup.sh >> backups/backup.log 2>&1
# 备份文件最好再同步到对象存储（服务器整个坏掉时才救得回来）。
set -euo pipefail

mkdir -p backups
file="backups/hyt-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U hyt hyt | gzip > "$file"
find backups -name 'hyt-*.sql.gz' -mtime +7 -delete
echo "$(date '+%F %T') 已备份到 $file"
