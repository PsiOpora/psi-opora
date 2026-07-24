"""
Bitrix24 CRM "Источник" cleanup: merges duplicate directory entries
(Telegram/MAX/WhatsApp variants) into three canonical values, across
leads, deals, contacts and companies.

Setup:
    pip install requests
    export BITRIX_WEBHOOK_URL="https://your-portal.bitrix24.ru/rest/1/xxxxxxxxxxxxxxxx/"

Usage (always run in this order):
    python bitrix-merge-crm-sources.py --plan
        Prints the current directory + how many records reference each
        value to merge. Makes no changes.

    python bitrix-merge-crm-sources.py --apply
        Reassigns SOURCE_ID on all matching leads/deals/contacts/companies
        to the canonical value, and renames the three canonical directory
        entries. Does NOT delete the now-empty old directory entries.

    python bitrix-merge-crm-sources.py --cleanup
        Deletes old directory entries that no longer have any records
        pointing at them (re-checks before each delete; refuses to delete
        anything still referenced).

Webhook needs scopes: crm (read+write) covering leads, deals, contacts,
companies and the CRM status directory.
"""

import argparse
import os
import sys
import time
from urllib.parse import urlencode

import requests

WEBHOOK = os.environ.get("BITRIX_WEBHOOK_URL", "").rstrip("/") + "/"

ENTITY_TYPE_IDS = {
    "lead": 1,
    "deal": 2,
    "contact": 3,
    "company": 4,
}

# canonical name -> {rename_from: old NAME to become the canonical one,
#                     merge_from: other NAMEs whose records move to the canonical one}
MERGE_PLAN = {
    "Telegram": {
        "rename_from": "Telegram-бот",
        "merge_from": [
            "Инвайт ТГ",
            "WAZZUP: Telegram - Открытая линия",
            "Tgapi Клюев Андрей ТГ",
            "Tgapi 79310096002",
            "TG Bot kluevzabotabot",
            "Tgapi ТГ 3332",
            "Telegram kluvand_bot",
        ],
    },
    "MAX": {
        "rename_from": "MAX-бот",
        "merge_from": [
            "Инвайт МАКС",
            "MAX - МАКС",
            "WAZZUP: Max - Открытая линия 2",
            "Max 79307073332",
            "Max МАКС 79307073332",
            "Maxbot id525603925717_bot",
        ],
    },
    "WhatsApp": {
        "rename_from": "Whatsapp 79307073332",
        "merge_from": [],
    },
}


def call(method, params=None):
    resp = requests.post(WEBHOOK + method, json=params or {}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"{method} failed: {data.get('error_description', data['error'])}")
    return data


def batch(cmd):
    """cmd: dict[key] -> (method, params dict). Runs in chunks of 50, halt=0."""
    items = list(cmd.items())
    results = {}
    errors = {}
    for i in range(0, len(items), 50):
        chunk = dict(items[i:i + 50])
        encoded = {k: f"{m}?{urlencode(p, doseq=True)}" for k, (m, p) in chunk.items()}
        data = call("batch", {"halt": 0, "cmd": encoded})
        results.update(data["result"]["result"])
        errors.update(data["result"].get("result_error", {}))
        time.sleep(0.3)
    return results, errors


def get_source_directory():
    """Returns dict[NAME] -> list of {ID, STATUS_ID, NAME} (names can repeat)."""
    items = call("crm.status.list", {
        "filter": {"ENTITY_ID": "SOURCE"},
        "order": {"SORT": "ASC"},
    })["result"]
    by_name = {}
    for item in items:
        by_name.setdefault(item["NAME"], []).append(item)
    return by_name, items


def find_items_by_source(entity_type_id, source_codes, select=("id",)):
    found = []
    start = 0
    while True:
        data = call("crm.item.list", {
            "entityTypeId": entity_type_id,
            "select": list(select),
            "filter": {"@sourceId": source_codes},
            "start": start,
        })
        items = data["result"].get("items", [])
        found.extend(items)
        nxt = data.get("next")
        if nxt is None:
            break
        start = nxt
    return found


def plan():
    by_name, _ = get_source_directory()
    print("=== Текущий справочник Источник ===")
    for name, entries in by_name.items():
        for e in entries:
            print(f"  ID={e['ID']:<5} STATUS_ID={e['STATUS_ID']:<20} NAME={name}")
    print()

    for canonical, cfg in MERGE_PLAN.items():
        rename_from = cfg["rename_from"]
        merge_from = cfg["merge_from"]
        print(f"--- {canonical} (переименовать из «{rename_from}») ---")
        if rename_from not in by_name:
            print(f"  !! НЕ НАЙДЕНО в справочнике: {rename_from}")
            continue
        canonical_codes = [e["STATUS_ID"] for e in by_name[rename_from]]
        for old_name in merge_from:
            entries = by_name.get(old_name)
            if not entries:
                print(f"  !! НЕ НАЙДЕНО в справочнике: {old_name}")
                continue
            old_codes = [e["STATUS_ID"] for e in entries]
            for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
                try:
                    items = find_items_by_source(entity_type_id, old_codes)
                    if items:
                        print(f"  {old_name}: {len(items)} записей в {entity_name}")
                except RuntimeError as e:
                    print(f"  {old_name}: {entity_name} недоступен для sourceId ({e})")
        print()


def apply_merge():
    by_name, _ = get_source_directory()

    for canonical, cfg in MERGE_PLAN.items():
        rename_from = cfg["rename_from"]
        merge_from = cfg["merge_from"]

        if rename_from not in by_name:
            print(f"!! Пропускаю {canonical}: не найден исходник «{rename_from}»")
            continue

        canonical_entry = by_name[rename_from][0]
        canonical_id = canonical_entry["ID"]
        canonical_code = canonical_entry["STATUS_ID"]

        old_codes = []
        for old_name in merge_from:
            for e in by_name.get(old_name, []):
                old_codes.append(e["STATUS_ID"])

        if old_codes:
            print(f"=== {canonical}: переношу записи с {old_codes} на {canonical_code} ===")
            for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
                try:
                    items = find_items_by_source(entity_type_id, old_codes)
                except RuntimeError as e:
                    print(f"  {entity_name}: пропущено ({e})")
                    continue
                if not items:
                    continue
                print(f"  {entity_name}: обновляю {len(items)} записей")
                cmd = {
                    f"u{item['id']}": (
                        "crm.item.update",
                        {
                            "entityTypeId": entity_type_id,
                            "id": item["id"],
                            "fields": {"sourceId": canonical_code},
                        },
                    )
                    for item in items
                }
                _, errors = batch(cmd)
                if errors:
                    print(f"    ошибки: {errors}")

        print(f"Переименовываю directory ID={canonical_id} «{rename_from}» -> «{canonical}»")
        call("crm.status.update", {"id": canonical_id, "fields": {"NAME": canonical}})
        print()

    print("Готово. Старые пункты справочника пока не удалены — запустите --cleanup после проверки.")


def cleanup():
    by_name, _ = get_source_directory()
    for canonical, cfg in MERGE_PLAN.items():
        for old_name in cfg["merge_from"]:
            for e in list(by_name.get(old_name, [])):
                still_referenced = False
                for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
                    try:
                        items = find_items_by_source(entity_type_id, [e["STATUS_ID"]])
                    except RuntimeError:
                        continue
                    if items:
                        still_referenced = True
                        print(f"!! {old_name} (ID={e['ID']}) всё ещё используется в {entity_name} ({len(items)}), не удаляю")
                if not still_referenced:
                    print(f"Удаляю пустой пункт справочника: {old_name} (ID={e['ID']})")
                    call("crm.status.delete", {"id": e["ID"]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--plan", action="store_true")
    group.add_argument("--apply", action="store_true")
    group.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()

    if not os.environ.get("BITRIX_WEBHOOK_URL"):
        sys.exit("Задайте переменную окружения BITRIX_WEBHOOK_URL")

    if args.plan:
        plan()
    elif args.apply:
        apply_merge()
    elif args.cleanup:
        cleanup()
