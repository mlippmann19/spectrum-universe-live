#!/usr/bin/env python3
"""Seed ERP Production Board data into Supabase.

Reads /home/user/workspace/production_board_data.json and inserts:
  - open_orders + shipped_orders into installation_jobs
  - weekly_ops checklist rows into installation_checklist_items

Idempotent: uses ON CONFLICT DO NOTHING / DO UPDATE on the unique keys
(wo_number for jobs; (job_id, operation) for checklist items).
"""
import json
import os
import sys
import urllib.request
import urllib.error

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "tplkmtmuoyslmjewcudk")
SBP_TOKEN = os.environ.get("SBP_TOKEN")
DATA_FILE = os.environ.get(
    "PRODUCTION_BOARD_DATA",
    "/home/user/workspace/production_board_data.json",
)

if not SBP_TOKEN:
    sys.exit(
        "SBP_TOKEN env var required (Supabase Management API access token). "
        "Get one from https://supabase.com/dashboard/account/tokens"
    )

OPS_CAPACITY = {
    "seams":      {"label": "Cutting / Seaming",  "phase": "prep",    "sort": 1,  "q_per_shift": 3},
    "expansion":  {"label": "Expansion",          "phase": "expand",  "sort": 2,  "q_per_shift": 5},
    "mandrel":    {"label": "Mandrel",            "phase": "expand",  "sort": 3,  "q_per_shift": 4},
    "polish":     {"label": "Polish",             "phase": "expand",  "sort": 4,  "q_per_shift": 5},
    "crates":     {"label": "Crates",             "phase": "pack",    "sort": 5,  "q_per_shift": 1},
    "skids":      {"label": "Skids",              "phase": "pack",    "sort": 6,  "q_per_shift": 3},
    "tubes":      {"label": "Tubes",              "phase": "pack",    "sort": 7,  "q_per_shift": 40},
    "inst_cover": {"label": "Install — Cover",    "phase": "install", "sort": 8,  "q_per_shift": 2.5},
    "inst_coat":  {"label": "Install — Coating",  "phase": "install", "sort": 9,  "q_per_shift": 1.5},
    "rcs":        {"label": "RCS",                "phase": "rcs",     "sort": 10, "q_per_shift": 7},
}


def run_sql(query: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": f"Bearer {SBP_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "spectrum-erp-seed/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"HTTP {e.code}: {body[:2000]}", file=sys.stderr)
        raise


def sql_str(v):
    if v is None:
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def sql_num(v):
    if v is None or v == "" or v == "var":
        return "NULL"
    try:
        f = float(str(v).replace(",", "").replace("$", "").strip())
        return str(f)
    except (ValueError, TypeError):
        return "NULL"


def sql_int(v):
    if v is None or v == "" or v == "TBD":
        return "NULL"
    try:
        return str(int(float(str(v).strip())))
    except (ValueError, TypeError):
        return "NULL"


def sql_date(v):
    if not v:
        return "NULL"
    s = str(v).strip()
    # Already ISO
    import re
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return f"'{s}'::date"
    # M/YYYY -> first of month
    m = re.match(r"^(\d{1,2})/(\d{4})$", s)
    if m:
        return f"'{int(m.group(2)):04d}-{int(m.group(1)):02d}-01'::date"
    # M/D/YY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2})$", s)
    if m:
        return f"'20{int(m.group(3)):02d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'::date"
    # M/D/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        return f"'{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'::date"
    # Otherwise treat as relative / TBD — return NULL
    return "NULL"


def sql_bool(v):
    return "TRUE" if v else "FALSE"


def order_row_values(order: dict, status: str) -> str:
    """Build a single VALUES tuple for an installation_jobs insert."""
    wo = order["wo_number"]
    customer = order.get("customer")
    state = order.get("state")
    country = order.get("country") or "USA"
    site = ", ".join([p for p in (state, country) if p]) or "—"
    return (
        "("
        + ",".join([
            # legacy NOT NULL columns
            sql_str(wo),                         # job_no
            sql_str(customer),                   # customer_name
            sql_str(site),                       # site
            # production-board columns
            sql_str(wo),                         # wo_number
            sql_str(order.get("category") or "sleeve"),
            sql_str(status),
            sql_str(customer),                   # customer
            sql_str(order.get("state")),
            sql_str(order.get("country") or "USA"),
            sql_int(order.get("quantity")),
            sql_num(order.get("diameter_in")),
            sql_num(order.get("face_length_in")),
            sql_str(order.get("position_type")),
            sql_str(order.get("rep_code")),
            sql_str(order.get("product_code")),
            sql_num(order.get("thickness")),
            sql_num(order.get("price")),
            sql_num(order.get("cogs")) if str(order.get("cogs") or "").replace(".", "").replace("-", "").isdigit() else "NULL",
            sql_date(order.get("date_received")),
            sql_date(order.get("promised_ship_date")),
            sql_str(order.get("ship_date_type") or "fixed"),
            sql_int(order.get("ship_date_offset_days")),
            sql_date(order.get("actual_ship_date")),
            sql_int(order.get("scheduled_month")),
            sql_str(order.get("notes")),
        ])
        + ")"
    )


JOB_COLS = [
    "job_no", "customer_name", "site",
    "wo_number", "category", "status",
    "customer", "state_code", "country", "quantity",
    "diameter_in", "face_length_in", "position_type",
    "rep_code", "product_code", "thickness", "price", "cogs",
    "date_received", "promised_ship_date", "ship_date_type", "ship_date_offset_days",
    "actual_ship_date", "scheduled_month", "notes",
]


def seed_jobs(open_orders, shipped_orders):
    rows = []
    for o in open_orders:
        rows.append(order_row_values(o, "in_production"))
    for o in shipped_orders:
        rows.append(order_row_values(o, "shipped"))
    sql = (
        f"INSERT INTO installation_jobs ({', '.join(JOB_COLS)}) VALUES\n"
        + ",\n".join(rows)
        + "\nON CONFLICT (wo_number) WHERE wo_number IS NOT NULL DO NOTHING;"
    )
    # The partial unique index supports ON CONFLICT only if we specify the index columns
    # Use the column-form which matches the partial unique index
    print(f"Inserting {len(rows)} jobs...")
    run_sql(sql)


def seed_checklists(weekly_ops):
    # Fetch job id map
    res = run_sql(
        "SELECT wo_number, id FROM installation_jobs WHERE wo_number IS NOT NULL;"
    )
    wo_to_id = {row["wo_number"]: row["id"] for row in res}
    print(f"Found {len(wo_to_id)} jobs by wo_number")

    rows = []
    skipped_wos = []
    for wo, ops in weekly_ops.items():
        job_id = wo_to_id.get(wo)
        if not job_id:
            skipped_wos.append(wo)
            continue
        for op_key, qty in ops.items():
            qty = int(qty or 0)
            if qty <= 0:
                continue
            meta = OPS_CAPACITY.get(op_key)
            if not meta:
                continue
            rows.append(
                "("
                + ",".join([
                    f"'{job_id}'::uuid",
                    sql_str(meta["phase"]),    # stage (legacy NOT NULL)
                    sql_str(op_key),           # category (legacy NOT NULL) - reuse operation key
                    sql_str(meta["label"]),    # item (legacy NOT NULL)
                    sql_str(op_key),           # operation
                    sql_str(meta["phase"]),    # phase
                    sql_str(meta["label"]),    # label
                    str(qty),
                    "0",
                    "FALSE",
                    str(meta["q_per_shift"]),
                    str(meta["sort"]),
                ])
                + ")"
            )

    if skipped_wos:
        print(f"Skipped weekly_ops WOs not in installation_jobs: {skipped_wos}")
    if not rows:
        print("No checklist rows to insert")
        return

    cols = [
        "job_id",
        "stage", "category", "item",        # legacy NOT NULL
        "operation", "phase", "label",      # production-board
        "quantity_required", "quantity_completed", "is_complete",
        "q_per_shift", "sort_order",
    ]
    sql = (
        f"INSERT INTO installation_checklist_items ({', '.join(cols)}) VALUES\n"
        + ",\n".join(rows)
        + "\nON CONFLICT (job_id, operation) WHERE operation IS NOT NULL DO UPDATE SET "
        + "quantity_required = EXCLUDED.quantity_required, "
        + "phase = EXCLUDED.phase, "
        + "label = EXCLUDED.label, "
        + "q_per_shift = EXCLUDED.q_per_shift, "
        + "sort_order = EXCLUDED.sort_order;"
    )
    print(f"Inserting {len(rows)} checklist items...")
    run_sql(sql)


def main():
    with open(DATA_FILE) as f:
        data = json.load(f)

    seed_jobs(data["open_orders"], data["shipped_orders"])
    seed_checklists(data["weekly_ops"])

    counts = run_sql(
        "SELECT "
        " (SELECT COUNT(*) FROM installation_jobs WHERE wo_number IS NOT NULL) AS jobs,"
        " (SELECT COUNT(*) FROM installation_jobs WHERE status='in_production') AS in_production,"
        " (SELECT COUNT(*) FROM installation_jobs WHERE status='shipped') AS shipped,"
        " (SELECT COUNT(*) FROM installation_checklist_items WHERE operation IS NOT NULL) AS checklist_items;"
    )
    print("\nFinal counts:", json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
