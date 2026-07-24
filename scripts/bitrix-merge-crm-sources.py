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

# entityTypeId -> whether it has a "sourceId" field, filled in lazily by
# entity_supports_source(). Never assume - contacts/companies may not have
# this field on every portal, and an unsupported "@sourceId" filter could
# in theory be ignored by the API instead of erroring, which would turn a
# "merge these 12 records" update into "update every contact in the CRM".
_SOURCE_FIELD_SUPPORT = {}

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


def _flatten_params(params, prefix=""):
    """Bitrix batch cmd values are query strings, not JSON, so nested dicts
    (e.g. fields={"sourceId": ...}) must become fields[sourceId]=... pairs.
    Plain urlencode() on a dict-valued param silently drops the value and
    only encodes the dict's keys - it would send fields=sourceId instead of
    fields[sourceId]=UC_XXX. That doesn't corrupt data (Bitrix rejects the
    malformed field and the update errors out), but it means the merge
    silently never applies, so it still needs fixing."""
    pairs = []
    for k, v in params.items():
        key = f"{prefix}[{k}]" if prefix else str(k)
        if isinstance(v, dict):
            pairs.extend(_flatten_params(v, key))
        elif isinstance(v, (list, tuple)):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    pairs.extend(_flatten_params(item, f"{key}[{i}]"))
                else:
                    pairs.append((f"{key}[{i}]", item))
        else:
            pairs.append((key, v))
    return pairs


def batch(cmd):
    """cmd: dict[key] -> (method, params dict). Runs in chunks of 50, halt=0."""
    items = list(cmd.items())
    results = {}
    errors = {}
    for i in range(0, len(items), 50):
        chunk = dict(items[i:i + 50])
        encoded = {k: f"{m}?{urlencode(_flatten_params(p))}" for k, (m, p) in chunk.items()}
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


def entity_supports_source(entity_type_id):
    """Checks the real field schema for this entity type instead of assuming
    all four entities (lead/deal/contact/company) have sourceId, and instead
    of relying on the API to error out on an unknown filter field."""
    if entity_type_id not in _SOURCE_FIELD_SUPPORT:
        data = call("crm.item.fields", {"entityTypeId": entity_type_id})
        fields = data["result"].get("fields", {})
        _SOURCE_FIELD_SUPPORT[entity_type_id] = "sourceId" in fields
    return _SOURCE_FIELD_SUPPORT[entity_type_id]


def find_items_by_source(entity_type_id, source_codes, select=("id",)):
    """Returns None (not []) if this entity type has no sourceId field at
    all, so callers can tell "nothing to merge" apart from "can't check"."""
    if not entity_supports_source(entity_type_id):
        return None

    found = []
    start = 0
    seen_starts = set()
    while True:
        data = call("crm.item.list", {
            "entityTypeId": entity_type_id,
            "select": list(select),
            "filter": {"@sourceId": list(source_codes)},
            "start": start,
        })
        result = data.get("result", {})
        items = result.get("items", []) if isinstance(result, dict) else []
        found.extend(items)
        nxt = data.get("next", result.get("next") if isinstance(result, dict) else None)
        if nxt is None or nxt in seen_starts:
            break
        seen_starts.add(nxt)
        start = nxt
    return found


def plan():
    by_name, _ = get_source_directory()
    print("=== Текущий справочник Источник ===")
    for name, entries in by_name.items():
        for e in entries:
            print(f"  ID={e['ID']:<5} STATUS_ID={e['STATUS_ID']:<20} NAME={name}")
    print()

    print("=== Поддержка поля sourceId по типам сущностей ===")
    for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
        supported = entity_supports_source(entity_type_id)
        print(f"  {entity_name}: {'да' if supported else 'НЕТ — будет пропущен'}")
    print()

    for canonical, cfg in MERGE_PLAN.items():
        rename_from = cfg["rename_from"]
        merge_from = cfg["merge_from"]
        print(f"--- {canonical} (переименовать из «{rename_from}») ---")
        if rename_from not in by_name:
            print(f"  !! НЕ НАЙДЕНО в справочнике: {rename_from}")
            continue
        for old_name in merge_from:
            entries = by_name.get(old_name)
            if not entries:
                print(f"  !! НЕ НАЙДЕНО в справочнике: {old_name}")
                continue
            old_codes = [e["STATUS_ID"] for e in entries]
            for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
                items = find_items_by_source(entity_type_id, old_codes)
                if items:
                    print(f"  {old_name}: {len(items)} записей в {entity_name}")
        print()


def _collect_apply_plan(by_name):
    """Dry-computes exactly what apply_merge() would write, with no side
    effects, so the totals shown at the confirmation prompt are guaranteed
    to match what actually gets updated."""
    work = []  # list of (canonical, canonical_id, canonical_code, entity_name, entity_type_id, items)
    skipped = []
    for canonical, cfg in MERGE_PLAN.items():
        rename_from = cfg["rename_from"]
        merge_from = cfg["merge_from"]

        if rename_from not in by_name:
            skipped.append(f"{canonical}: не найден исходник «{rename_from}»")
            continue

        canonical_entry = by_name[rename_from][0]
        canonical_id = canonical_entry["ID"]
        canonical_code = canonical_entry["STATUS_ID"]

        old_codes = []
        for old_name in merge_from:
            entries = by_name.get(old_name)
            if not entries:
                skipped.append(f"{canonical}: не найден дубль «{old_name}» (пропускаю только его)")
                continue
            old_codes.extend(e["STATUS_ID"] for e in entries)

        for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
            if not entity_supports_source(entity_type_id):
                continue
            items = find_items_by_source(entity_type_id, old_codes) if old_codes else []
            work.append((canonical, canonical_id, canonical_code, entity_name, entity_type_id, items or []))
    return work, skipped


def apply_merge():
    by_name, _ = get_source_directory()
    work, skipped = _collect_apply_plan(by_name)

    print("=== План изменений ===")
    for msg in skipped:
        print(f"  !! {msg}")
    total = 0
    for canonical, _, canonical_code, entity_name, _, items in work:
        if items:
            print(f"  {canonical}: {len(items)} записей в {entity_name} -> sourceId={canonical_code}")
            total += len(items)
    for canonical, cfg in MERGE_PLAN.items():
        print(f"  Переименовать «{cfg['rename_from']}» -> «{canonical}»")
    print(f"\nВсего записей будет обновлено: {total}")

    answer = input("\nВведите ДА для применения изменений: ").strip()
    if answer != "ДА":
        print("Отменено, ничего не изменено.")
        return

    for canonical, canonical_id, canonical_code, entity_name, entity_type_id, items in work:
        if not items:
            continue
        print(f"{canonical} / {entity_name}: обновляю {len(items)} записей")
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
            print(f"  ошибки: {errors}")

    for canonical, cfg in MERGE_PLAN.items():
        rename_from = cfg["rename_from"]
        if rename_from not in by_name:
            continue
        canonical_id = by_name[rename_from][0]["ID"]
        print(f"Переименовываю directory ID={canonical_id} «{rename_from}» -> «{canonical}»")
        call("crm.status.update", {"id": canonical_id, "fields": {"NAME": canonical}})

    print("\nГотово. Старые пункты справочника пока не удалены — запустите --cleanup после проверки.")


def cleanup():
    by_name, _ = get_source_directory()

    to_delete = []
    for canonical, cfg in MERGE_PLAN.items():
        for old_name in cfg["merge_from"]:
            for e in list(by_name.get(old_name, [])):
                still_referenced = False
                for entity_name, entity_type_id in ENTITY_TYPE_IDS.items():
                    if not entity_supports_source(entity_type_id):
                        continue
                    items = find_items_by_source(entity_type_id, [e["STATUS_ID"]])
                    if items:
                        still_referenced = True
                        print(f"!! {old_name} (ID={e['ID']}) всё ещё используется в {entity_name} ({len(items)}), не удаляю")
                if not still_referenced:
                    to_delete.append((old_name, e["ID"]))

    if not to_delete:
        print("Нечего удалять.")
        return

    print("\nБудут удалены пустые пункты справочника:")
    for old_name, status_id in to_delete:
        print(f"  {old_name} (ID={status_id})")

    answer = input("\nВведите ДА для удаления: ").strip()
    if answer != "ДА":
        print("Отменено, ничего не удалено.")
        return

    for old_name, status_id in to_delete:
        print(f"Удаляю: {old_name} (ID={status_id})")
        call("crm.status.delete", {"id": status_id})


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
