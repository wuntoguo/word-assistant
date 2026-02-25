#!/bin/bash
# 手动触发每日任务（crawl + embedding + recommend-precompute）
# 用法: CRON_SECRET=你的密钥 ./scripts/trigger-daily.sh

set -e
if [ -z "$CRON_SECRET" ]; then
  echo "请设置 CRON_SECRET 环境变量"
  echo "用法: CRON_SECRET=xxx ./scripts/trigger-daily.sh"
  exit 1
fi

echo "正在触发 daily pipeline（可能需 5–10 分钟）..."
curl -sf --max-time 600 -X POST "https://feedlingo.fly.dev/api/cron/daily" \
  -H "Authorization: Bearer $CRON_SECRET" | jq . || cat
echo ""
echo "完成"
