#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from artemis import Artemis

# ---------------- Config ----------------
API = Artemis(api_key=os.environ["ARTEMIS_API_KEY"])
ASSET = "pump"

# rolling window (adjust as you like)
WINDOW_DAYS = 120
TODAY = datetime.now(timezone.utc).date()
START = (TODAY - timedelta(days=WINDOW_DAYS)).isoformat()
END = TODAY.isoformat()

os.makedirs("data", exist_ok=True)


# --------------- Helpers ----------------
def to_df_vals(rows, colname):
    """
    Convert Artemis rows -> tidy df(date, <colname>), coercing bad values to NaN.
    Handles:
      - rows as list[dict] or {"rows":[...]}
      - value column in: v / val / value / already-named
      - time column in: t(ms) / timestamp / date / time
    """
    if not rows:
        return pd.DataFrame(columns=["date", colname])

    if isinstance(rows, dict) and "rows" in rows and isinstance(rows["rows"], list):
        rows = rows["rows"]

    if not isinstance(rows, list) or (rows and not isinstance(rows[0], dict)):
        return pd.DataFrame(columns=["date", colname])

    df = pd.DataFrame(rows)

    # value column
    if colname not in df.columns:
        for k in ("v", "val", "value"):
            if k in df.columns:
                df = df.rename(columns={k: colname})
                break
        if colname not in df.columns:
            df[colname] = pd.NA

    # date column
    if "t" in df.columns:
        df["date"] = (
            pd.to_datetime(df["t"], unit="ms", errors="coerce")
              .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize()
        )
    elif "timestamp" in df.columns:
        df["date"] = (
            pd.to_datetime(df["timestamp"], errors="coerce")
              .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize()
        )
    elif "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
    elif "time" in df.columns:
        df["date"] = pd.to_datetime(df["time"], errors="coerce")
    else:
        return pd.DataFrame(columns=["date", colname])

    df[colname] = pd.to_numeric(df[colname], errors="coerce")
    df = df.loc[~df["date"].isna(), ["date", colname]]
    return df.sort_values("date").reset_index(drop=True)


def fetch_block(metric_names: str):
    r = API.fetch_metrics(metric_names=metric_names, symbols=ASSET,
                          start_date=START, end_date=END)
    return r.model_dump() if hasattr(r, "model_dump") else r.__dict__


def ensure_cumulative(series: pd.Series) -> pd.Series:
    s = series.copy()
    if s.dropna().is_monotonic_increasing:
        return s
    return s.fillna(0).cumsum()


def _norm(s: str) -> str:
    # normalize a key: lowercase & strip non-alphanumerics
    return "".join(ch for ch in str(s).lower() if ch.isalnum())


# --------------- 1) Price + Fees ----------------
resp = API.fetch_metrics(
    metric_names="price,fees",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

df_price = to_df_vals(sym.get("price", []), "price")
df_fees = to_df_vals(sym.get("fees", []), "fees")
df_pf = pd.merge(df_price, df_fees, on="date", how="outer").sort_values("date")

with open("data/pump.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price": None if pd.isna(p) else float(p),
                "fees": None if pd.isna(x) else float(x),
            }
            for d, p, x in zip(df_pf["date"], df_pf["price"], df_pf["fees"])
        ]
    }, f, indent=2)
print("wrote data/pump.json rows:", len(df_pf))


# --------------- 2) Price + Revenue (fallback to fees) ----------------
def try_fetch(metric_names: str):
    r = API.fetch_metrics(metric_names=metric_names, symbols=ASSET,
                          start_date=START, end_date=END)
    return r.model_dump() if hasattr(r, "model_dump") else r.__dict__


candidates = [
    "price,revenue",
    "price,protocol_revenue",
    "price,revenue_usd",
    "price,fees",  # fallback
]

sym_rev, used_key = None, None
for mset in candidates:
    try:
        p = try_fetch(mset)
        d = p["data"]["symbols"][ASSET]
        for k in ["revenue", "protocol_revenue", "revenue_usd", "fees"]:
            if k in d:
                sym_rev, used_key = d, k
                break
        if sym_rev:
            break
    except Exception:
        pass

if sym_rev is None:
    raise RuntimeError("No revenue-like metric found (tried revenue/protocol_revenue/revenue_usd/fees).")

df_price_r = to_df_vals(sym_rev.get("price", []), "price")
df_rev = to_df_vals(sym_rev.get(used_key, []), "revenue")
df_pr = pd.merge(df_price_r, df_rev, on="date", how="outer").sort_values("date")

with open("data/pump_price_revenue.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price": None if pd.isna(p) else float(p),
                "revenue": None if pd.isna(rv) else float(rv),
            }
            for d, p, rv in zip(df_pr["date"], df_pr["price"], df_pr["revenue"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_revenue.json using metric:", used_key, "rows:", len(df_pr))


# --------------- 3) Price + Buybacks (USD) ----------------
resp_bb = API.fetch_metrics(
    metric_names="price,buybacks_native",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym_bb = (resp_bb.model_dump() if hasattr(resp_bb, "model_dump") else resp_bb.__dict__)["data"]["symbols"][ASSET]

df_price2 = to_df_vals(sym_bb.get("price", []), "price")
df_bb_native = to_df_vals(sym_bb.get("buybacks_native", []), "buybacks_native")
print("buybacks section: len(price)=", len(df_price2), "len(buybacks_native)=", len(df_bb_native))

df_pbb = (
    pd.merge(df_price2, df_bb_native, on="date", how="outer")
    .sort_values("date")
    .reset_index(drop=True)
)
df_pbb["buybacks_native"] = df_pbb["buybacks_native"].ffill()  # carry-forward
df_pbb["buybacks_usd"] = df_pbb["buybacks_native"] * df_pbb["price"]

with open("data/pump_price_buybacks_usd.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price": None if pd.isna(p) else float(p),
                "buybacks_usd": None if pd.isna(bu) else float(bu),
            }
            for d, p, bu in zip(df_pbb["date"], df_pbb["price"], df_pbb["buybacks_usd"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_buybacks_usd.json rows:", len(df_pbb))


# ---------- 4) PUMP: Cumulative Buybacks (USD) vs Market Cap ----------

resp = API.fetch_metrics(
    metric_names="mc,buybacks",       # exactly the two you need
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

# Normalize to tidy dataframes
df_mc  = to_df_vals(sym.get("mc", []), "mcap_usd")
df_bb  = to_df_vals(sym.get("buybacks", []), "buybacks_usd")  # treat as USD series

# Make sure buybacks are cumulative (if the metric is already cumulative, this is a no-op)
df_bb["cum_buybacks_usd"] = ensure_cumulative(df_bb["buybacks_usd"])

# Merge to a single frame for writing/plotting
df_core = (
    pd.merge(df_mc, df_bb[["date", "cum_buybacks_usd"]], on="date", how="outer")
      .sort_values("date").reset_index(drop=True)
)

# Optional: forward-fill market cap if sparse
df_core["mcap_usd"] = df_core["mcap_usd"].ffill()

# Write JSON for the chart (cumulative buybacks on one axis, market cap on the other)
out_file = "data/pump_buybacks_vs_mcap.json"
with open(out_file, "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "cum_buybacks_usd": None if pd.isna(cb) else float(cb),
                "mcap_usd": None if pd.isna(mc) else float(mc),
            }
            for d, cb, mc in zip(
                df_core["date"],
                df_core["cum_buybacks_usd"],
                df_core["mcap_usd"],
            )
        ]
    }, f, indent=2)

print("wrote", out_file, "rows:", len(df_core))



