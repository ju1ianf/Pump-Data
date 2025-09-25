#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
from datetime import datetime, timezone
import pandas as pd
from artemis import Artemis
from pathlib import Path

# ---------------- Config ----------------
API   = Artemis(api_key=os.environ["ARTEMIS_API_KEY"])
ASSET = "pump"                           # use "pump" if that's how Artemis lists the symbol
START = "2025-07-17"                     # fixed start date for PUMP charts
END   = datetime.now(timezone.utc).date().isoformat()

# YTD needs Jan 1 (UTC) of the current year
NOW_UTC = datetime.now(timezone.utc)
START_PERF = datetime(NOW_UTC.year, 1, 1, tzinfo=timezone.utc).date().isoformat()

# output dirs
os.makedirs("data", exist_ok=True)
os.makedirs("data/perf", exist_ok=True)

# ---------------- Helpers ----------------
def to_df_vals(rows, colname):
    """Artemis rows -> tidy df(date, <colname>). Handles common field names (daily-like; normalizes to date)."""
    if not rows:
        return pd.DataFrame(columns=["date", colname])

    if isinstance(rows, dict) and "rows" in rows and isinstance(rows["rows"], list):
        rows = rows["rows"]

    if not isinstance(rows, list) or (rows and not isinstance(rows[0], dict)):
        return pd.DataFrame(columns=["date", colname])

    df = pd.DataFrame(rows)

    # value column
    if colname not in df.columns:
        for k in ("v", "val", "value", "close", "c", "p", "price"):
            if k in df.columns:
                df = df.rename(columns={k: colname})
                break
        if colname not in df.columns:
            df[colname] = pd.NA

    # date column (normalize to midnight UTC for your existing PUMP charts)
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

def to_df_vals_ts(rows, colname):
    """Like to_df_vals, but **keeps time** (no normalize). Used for the Performance tab (hourly is OK)."""
    if not rows:
        return pd.DataFrame(columns=["ts", colname])

    if isinstance(rows, dict) and "rows" in rows and isinstance(rows["rows"], list):
        rows = rows["rows"]

    if not isinstance(rows, list) or (rows and not isinstance(rows[0], dict)):
        return pd.DataFrame(columns=["ts", colname])

    df = pd.DataFrame(rows)

    # value column
    if colname not in df.columns:
        for k in ("p", "c", "close", "v", "val", "value", "price"):
            if k in df.columns:
                df = df.rename(columns={k: colname})
                break
        if colname not in df.columns:
            df[colname] = pd.NA

    # timestamp column (UTC, keep time)
    if "t" in df.columns:
        ts = pd.to_datetime(df["t"], unit="ms", errors="coerce", utc=True)
    elif "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    elif "time" in df.columns:
        ts = pd.to_datetime(df["time"], errors="coerce", utc=True)
    elif "date" in df.columns:
        ts = pd.to_datetime(df["date"], errors="coerce", utc=True)
    else:
        return pd.DataFrame(columns=["ts", colname])

    df["ts"] = ts
    df[colname] = pd.to_numeric(df[colname], errors="coerce")
    df = df.loc[~df["ts"].isna(), ["ts", colname]]
    return df.sort_values("ts").reset_index(drop=True)

def ensure_cumulative(series: pd.Series) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    if s.dropna().is_monotonic_increasing:
        return s
    return s.fillna(0).cumsum()

CUTOFF_STR = START
def trim_from(df: pd.DataFrame, date_col: str = "date", start: str = CUTOFF_STR) -> pd.DataFrame:
    cutoff = pd.to_datetime(start)
    out = df.copy()
    out[date_col] = pd.to_datetime(out[date_col])
    return out[out[date_col] >= cutoff].sort_values(date_col).reset_index(drop=True)

# ---------------- 1) Price + Fees ----------------
resp = API.fetch_metrics(
    metric_names="price,fees",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

df_price = to_df_vals(sym.get("price", []), "price")
df_fees  = to_df_vals(sym.get("fees",  []), "fees")
df_pf    = pd.merge(df_price, df_fees, on="date", how="outer").sort_values("date")
df_pf    = trim_from(df_pf)

with open("data/pump.json", "w") as f:
    json.dump({
        "series": [
            {"date": d.strftime("%Y-%m-%d"),
             "price": None if pd.isna(p) else float(p),
             "fees":  None if pd.isna(x) else float(x)}
            for d, p, x in zip(df_pf["date"], df_pf["price"], df_pf["fees"])
        ]
    }, f, indent=2)
print("wrote data/pump.json rows:", len(df_pf))

# ---------------- 2) Price + Revenue (fallback to fees) ----------------
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
            if k in d and d[k]:
                sym_rev, used_key = d, k
                break
        if sym_rev:
            break
    except Exception:
        pass

if sym_rev is None:
    raise RuntimeError("No revenue-like metric found (tried revenue/protocol_revenue/revenue_usd/fees).")

df_price_r = to_df_vals(sym_rev.get("price", []), "price")
df_rev      = to_df_vals(sym_rev.get(used_key, []), "revenue")
df_pr       = pd.merge(df_price_r, df_rev, on="date", how="outer").sort_values("date")
df_pr       = trim_from(df_pr)

with open("data/pump_price_revenue.json", "w") as f:
    json.dump({
        "series": [
            {"date": d.strftime("%Y-%m-%d"),
             "price":   None if pd.isna(p)  else float(p),
             "revenue": None if pd.isna(rv) else float(rv)}
            for d, p, rv in zip(df_pr["date"], df_pr["price"], df_pr["revenue"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_revenue.json using metric:", used_key, "rows:", len(df_pr))

# ---------------- 3) Price + Buybacks (USD) ----------------
resp_bb = API.fetch_metrics(
    metric_names="price,buybacks_native",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym_bb = (resp_bb.model_dump() if hasattr(resp_bb, "model_dump") else resp_bb.__dict__)["data"]["symbols"][ASSET]

df_price2     = to_df_vals(sym_bb.get("price", []), "price")
df_bb_native  = to_df_vals(sym_bb.get("buybacks_native", []), "buybacks_native")

df_pbb = (pd.merge(df_price2, df_bb_native, on="date", how="outer")
            .sort_values("date").reset_index(drop=True))
df_pbb["buybacks_native"] = df_pbb["buybacks_native"].ffill()
df_pbb["buybacks_usd"]    = df_pbb["buybacks_native"] * df_pbb["price"]
df_pbb                    = trim_from(df_pbb)

with open("data/pump_price_buybacks_usd.json", "w") as f:
    json.dump({
        "series": [
            {"date": d.strftime("%Y-%m-%d"),
             "price":        None if pd.isna(p)  else float(p),
             "buybacks_usd": None if pd.isna(bu) else float(bu)}
            for d, p, bu in zip(df_pbb["date"], df_pbb["price"], df_pbb["buybacks_usd"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_buybacks_usd.json rows:", len(df_pbb))

# ---------------- 4) Cumulative Buybacks (USD) vs Market Cap ----------------
resp4 = API.fetch_metrics(
    metric_names="price,buybacks_native,mc,circ_supply",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym4 = (resp4.model_dump() if hasattr(resp4, "model_dump") else resp4.__dict__)["data"]["symbols"][ASSET]

df_price4  = to_df_vals(sym4.get("price", []), "price")
df_bb_nat4 = to_df_vals(sym4.get("buybacks_native", []), "buybacks_native")
df_mc_raw  = to_df_vals(sym4.get("mc", []), "mcap_usd")
df_supply  = to_df_vals(sym4.get("circ_supply", []), "circ_supply")

# buybacks_usd and cumulative
df_bb4 = (df_bb_nat4.merge(df_price4, on="date", how="outer")
                    .sort_values("date").reset_index(drop=True))
df_bb4["buybacks_usd"]      = (df_bb4["buybacks_native"] * df_bb4["price"]).astype("float")
df_bb4                      = trim_from(df_bb4)
df_bb4["cum_buybacks_usd"]  = ensure_cumulative(df_bb4["buybacks_usd"])

# NEW: cumulative native (for “% of circulating supply” option)
df_bb4["cum_buybacks_native"] = ensure_cumulative(df_bb4["buybacks_native"])

# market cap: prefer mc; else price*circ_supply
df_core = df_bb4[["date", "cum_buybacks_usd", "cum_buybacks_native"]].copy()
if not df_mc_raw.empty:
    df_core = df_core.merge(trim_from(df_mc_raw), on="date", how="outer")
else:
    df_core["mcap_usd"] = pd.NA

if not df_supply.empty:
    tmp = (df_price4.merge(df_supply, on="date", how="outer")
                     .sort_values("date").reset_index(drop=True))
    tmp  = trim_from(tmp)
    tmp["mcap_from_supply"] = (tmp["price"] * tmp["circ_supply"]).astype("float")
    df_core = (df_core.merge(tmp[["date", "mcap_from_supply", "circ_supply"]], on="date", how="outer")
                     .sort_values("date", ascending=True).reset_index(drop=True))
    df_core["mcap_usd"] = pd.to_numeric(df_core["mcap_usd"], errors="coerce")
    df_core["mcap_usd"] = df_core["mcap_usd"].fillna(df_core["mcap_from_supply"])
else:
    df_core["circ_supply"] = pd.NA

df_core = trim_from(df_core)
df_core["mcap_usd"] = pd.to_numeric(df_core["mcap_usd"], errors="coerce").ffill()

# ===== NEW METRICS =====
# 1) Your requested proxy: % of market cap bought (rises with buybacks)
df_core["pct_mcap_bought"] = (df_core["cum_buybacks_usd"] / df_core["mcap_usd"]).replace([float("inf")], pd.NA)

# 2) Optional: % of circulating supply retired (requires native + supply)
df_core["pct_circ_retired"] = (df_core["cum_buybacks_native"] / df_core["circ_supply"]).replace([float("inf")], pd.NA)

with open("data/pump_buybacks_vs_mcap.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "cum_buybacks_usd": None if pd.isna(cb_usd) else float(cb_usd),
                "mcap_usd":         None if pd.isna(mc)     else float(mc),
                # NEW fields exposed to the frontend:
                "pct_mcap_bought":  None if pd.isna(p1)     else float(p1),
                "pct_circ_retired": None if pd.isna(p2)     else float(p2),
            }
            for d, cb_usd, mc, p1, p2 in zip(
                df_core["date"],
                df_core["cum_buybacks_usd"],
                df_core["mcap_usd"],
                df_core["pct_mcap_bought"],
                df_core["pct_circ_retired"],
            )
        ]
    }, f, indent=2)
print("wrote data/pump_buybacks_vs_mcap.json rows:", len(df_core))

# ---------------- 5) Performance series for dashboard ----------------
# Reads data/assets.json and writes each asset's price series to its "path" as [{t, p}, ...].
# Uses START_PERF so YTD is measured from Jan 1 UTC of the current year.
try:
    with open("data/assets.json", "r") as f:
        assets_idx = json.load(f)
except FileNotFoundError:
    assets_idx = {"assets": []}

def fetch_price_series(symbol: str):
    """Pull price series for Performance (keep timestamps)."""
    try:
        r = API.fetch_metrics(
            metric_names="price",
            symbols=symbol,
            start_date=START_PERF,   # <-- YTD-safe start
            end_date=END,
        )
        payload = r.model_dump() if hasattr(r, "model_dump") else r.__dict__
        dat = payload["data"]["symbols"].get(symbol, {})
        rows = dat.get("price", [])
        return to_df_vals_ts(rows, "price")
    except Exception as e:
        print(f"[perf] fetch failed for {symbol}: {e}")
        return pd.DataFrame(columns=["ts", "price"])

Path("data/perf").mkdir(parents=True, exist_ok=True)

for a in assets_idx.get("assets", []):
    sym  = a.get("symbol")
    path = a.get("path")
    if not sym or not path:
        continue

    df = fetch_price_series(sym)
    # keep only data from Jan 1 UTC (or first available point after)
    df = df[df["ts"] >= pd.to_datetime(START_PERF, utc=True)].reset_index(drop=True)

    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        out = [
            {"t": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "p": None if pd.isna(px) else float(px)}
            for ts, px in zip(df["ts"], df["price"])
        ]
        with open(path, "w") as f:
            json.dump(out, f, separators=(",", ":"))
        print(f"[perf ok] {sym} -> {path} ({len(out)} points)")
    except Exception as e:
        print(f"[perf fail] {sym}: {e}")

