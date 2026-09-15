#!/usr/bin/env bash
set -euo pipefail

# Тестовый запрос для метода imopenlines.crm.chat.get
# Повторяет вызов из packages/jobs/src/consultation-reminders.ts:312-316
#
# Запуск:
#   bash packages/jobs/scripts/test-imopenlines-crm-chat-get.sh 123
#
# Где 123 — ID контакта в CRM.

WEBHOOK_URL="${DASHBOARD_BITRIX_WEBHOOK_URL:-}"
CONTACT_ID="${1:-}"

if [ -z "$WEBHOOK_URL" ]; then
  echo "Ошибка: задай DASHBOARD_BITRIX_WEBHOOK_URL (из .env)"
  exit 1
fi

if [ -z "$CONTACT_ID" ]; then
  echo "Ошибка: передай ID контакта"
  echo "Пример: $0 123"
  exit 1
fi

BASE="${WEBHOOK_URL%/}"

curl -s -X POST "${BASE}/imopenlines.crm.chat.get.json" \
  -H "Content-Type: application/json" \
  -d "{
    \"CRM_ENTITY_TYPE\": \"contact\",
    \"CRM_ENTITY\": ${CONTACT_ID},
    \"ACTIVE_ONLY\": \"N\"
  }" | jq .
