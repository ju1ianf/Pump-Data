import os, json, pandas as pd
from datetime import datetime, timedelta, timezone
from artemis import Artemis

API = Artemis(api_key=os.environ["ARTEMIS_API_KEY"])
ASSET = "pump"

# ---------- Rolling window (change days as you like) ----------
WINDOW_DAYS = 120  # e.g., last 120 days; set to 365 or more if you prefer
TODAY = datetime.now(timezone.utc).date()
END = TODAY.isoformat()
START = (TODAY - timedelta(days=WINDOW_DAYS)).isoformat()


# ---------- One robust normalizer for all metrics ----------
def to_df_vals(rows, colname):
    """
    Convert Artemis rows -> tidy df(date, <colname>), coercing bad values to NaN.

    Defensive:
      - rows can be list[dict] or {"rows":[...]}
      - value column can be 'v', 'val', 'value', already-named, etc.
      - time column can be 't' (ms), 'timestamp', 'date', 'time'
      - non-numeric values -> NaN
    """
    if not rows:
        return pd.DataFrame(columns=["date", colname])

    if isinstance(rows, dict) and "rows" in rows and isinstance(rows["rows"], list):
        rows = rows["rows"]

    if not isinstance(rows, list) or (len(rows) > 0 and not isinstance(rows[0], dict)):
        return pd.DataFrame(columns=["date", colname])

    df = pd.DataFrame(rows)

    # Normalize value column to `colname`
    if colname in df.columns:
        pass
    elif "v" in df.columns:
        df = df.rename(columns={"v": colname})
    elif "val" in df.columns:
        df = df.rename(columns={"val": colname})
    elif "value" in df.columns:
        df = df.rename(columns={"value": colname})
    else:
        df[colname] = pd.NA  # if unknown, create empty col

    # Normalize/parse date column
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

    # Coerce numeric values
    df[colname] = pd.to_numeric(df[colname], errors="coerce")

    # Clean and return
    df = df.loc[~df["date"].isna(), ["date", colname]]
    return df.sort_values("date").reset_index(drop=True)


# ---------- 1) PUMP: Price + Fees -> data/pump.json ----------
resp = API.fetch_metrics(
    metric_names="price,fees",
    symbols=ASSET, start_date=START, end_date=END
)
sym = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

df_price = to_df_vals(sym.get("price", []), "price")
df_fees  = to_df_vals(sym.get("fees",  []), "fees")
df_pf = pd.merge(df_price, df_fees, on="date", how="outer").sort_values("date")

os.makedirs("data", exist_ok=True)
with open("data/pump.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price": None if pd.isna(p) else float(p),
                "fees":  None if pd.isna(x) else float(x)
            }
            for d, p, x in zip(df_pf["date"], df_pf["price"], df_pf["fees"])
        ]
    }, f, indent=2)
print("wrote data/pump.json rows:", len(df_pf))


# ---------- 2) PUMP: Price + Revenue (fallback to fees) -> data/pump_price_revenue.json ----------
def try_fetch(metric_names):
    r = API.fetch_metrics(metric_names=metric_names, symbols=ASSET,
                          start_date=START, end_date=END)
    return r.model_dump() if hasattr(r, "model_dump") else r.__dict__

candidates = [
    "price,revenue",
    "price,protocol_revenue",
    "price,revenue_usd",
    "price,fees",  # fallback – guarantees file creation
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
df_rev     = to_df_vals(sym_rev.get(used_key, []), "revenue")
df_pr = pd.merge(df_price_r, df_rev, on="date", how="outer").sort_values("date")

with open("data/pump_price_revenue.json", "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price":   None if pd.isna(p)  else float(p),
                "revenue": None if pd.isna(rv) else float(rv)
            }
            for d, p, rv in zip(df_pr["date"], df_pr["price"], df_pr["revenue"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_revenue.json using metric:", used_key, "rows:", len(df_pr))


# ---------- 3) PUMP: Price + Buybacks (Native) -> Buybacks (USD) ----------
resp = API.fetch_metrics(
    metric_names="price,buybacks_native",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym_bb = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

df_price2     = to_df_vals(sym_bb.get("price", []),            "price")
df_bb_native  = to_df_vals(sym_bb.get("buybacks_native", []),  "buybacks_native")
print("buybacks section: len(price)=", len(df_price2), "len(buybacks_native)=", len(df_bb_native))

df_pbb = (pd.merge(df_price2, df_bb_native, on="date", how="outer")
            .sort_values("date")
            .reset_index(drop=True))

# Rule: when buybacks_native is missing, use previous day's value
df_pbb["buybacks_native"] = df_pbb["buybacks_native"].ffill()

# Convert to USD
df_pbb["buybacks_usd"] = df_pbb["buybacks_native"] * df_pbb["price"]

out_file = "data/pump_price_buybacks_usd.json"
with open(out_file, "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "price":        None if pd.isna(p)  else float(p),
                "buybacks_usd": None if pd.isna(bu) else float(bu),
            }
            for d, p, bu in zip(df_pbb["date"], df_pbb["price"], df_pbb["buybacks_usd"])
        ]
    }, f, indent=2)
print(f"wrote {out_file} rows:", len(df_pbb))


# ---------- 4) PUMP: Cumulative Buybacks (USD) vs Market Cap -> data/pump_buybacks_vs_mcap.json ----------

def fetch_block(metric_names):
    r = API.fetch_metrics(metric_names=metric_names, symbols=ASSET,
                          start_date=START, end_date=END)
    return r.model_dump() if hasattr(r, "model_dump") else r.__dict__

# (a) Price + buybacks_native (unchanged)
resp_bb = API.fetch_metrics(
    metric_names="price,buybacks_native",
    symbols=ASSET,
    start_date=START,
    end_date=END,
)
sym_bb = (resp_bb.model_dump() if hasattr(resp_bb, "model_dump") else resp_bb.__dict__)["data"]["symbols"][ASSET]
df_price_bb = to_df_vals(sym_bb.get("price", []), "price")
df_bb_native = to_df_vals(sym_bb.get("buybacks_native", []), "buybacks_native").sort_values("date").reset_index(drop=True)
df_bb_native["buybacks_native"] = df_bb_native["buybacks_native"].ffill()

# (b) Candidate keys that count as market cap or supply
mcap_candidates = [
    "market_cap", "marketcap_usd", "marketcap",
    "circulating_market_cap", "circulating_market_cap_usd",
    "circulating_marketcap", "circ_market_cap",
    "cmc", "CMC",  # <-- added for your case
]
supply_candidates = ["circulating_supply", "supply_circulating", "supply"]

# Try to fetch any of those combos; we include cmc variants explicitly
sym_mc, used_mcap_key = None, None
try:
    queries = [
        # direct market-cap keys
        "price,market_cap", "price,marketcap_usd", "price,marketcap",
        "price,circulating_market_cap", "price,circulating_market_cap_usd",
        "price,circulating_marketcap", "price,circ_market_cap",
        "price,cmc", "price,CMC",                  # <-- added
        # supply fallbacks
        "price,circulating_supply", "price,supply_circulating", "price,supply",
    ]
    for names in queries:
        block = fetch_block(names)
        d = block["data"]["symbols"][ASSET]
        # prefer market-cap keys
        for k in mcap_candidates:
            if k in d:
                sym_mc, used_mcap_key = d, k
                break
        if sym_mc:
            break
        # otherwise supply keys
        for k in supply_candidates:
            if k in d:
                sym_mc, used_mcap_key = d, k
                break
        if sym_mc:
            break
except Exception:
    pass

# Build core frame
df_core = (
    pd.merge(df_price_bb, df_bb_native, on="date", how="outer")
      .sort_values("date").reset_index(drop=True)
)

# USD buybacks (cumulative)
df_core["buybacks_usd_raw"] = df_core["buybacks_native"] * df_core["price"]

def ensure_cumulative(series: pd.Series) -> pd.Series:
    s = series.copy()
    if s.dropna().is_monotonic_increasing:
        return s
    return s.fillna(0).cumsum()

df_core["cum_buybacks_usd"] = ensure_cumulative(df_core["buybacks_usd_raw"])

# Always create the column to avoid KeyError; fill if we found a metric
df_core["mcap_usd"] = pd.NA

if sym_mc is not None and used_mcap_key in mcap_candidates:
    # market cap is provided directly
    df_mcap = to_df_vals(sym_mc[used_mcap_key], "mcap_usd")
    df_core = (pd.merge(df_core, df_mcap, on="date", how="outer")
                 .sort_values("date").reset_index(drop=True))
elif sym_mc is not None and used_mcap_key in supply_candidates:
    # compute price * circulating supply
    df_sup = to_df_vals(sym_mc[used_mcap_key], "circ_supply")
    df_core = (pd.merge(df_core, df_sup, on="date", how="outer")
                 .sort_values("date").reset_index(drop=True))
    df_core["mcap_usd"] = df_core["price"] * df_core["circ_supply"]
else:
    # Helpful debug so you can see what's actually available
    try:
        peek = fetch_block("price,*")["data"]["symbols"][ASSET]
        print("DEBUG: No market cap/supply key matched. Available keys:", list(peek.keys()))
    except Exception:
        pass
    print("WARN: No market cap or supply metrics found; mcap_usd will remain NaN.")

# % of supply (proxy) retired
df_core["pct_bought"] = df_core["cum_buybacks_usd"] / df_core["mcap_usd"]

# Write JSON
os.makedirs("data", exist_ok=True)
out_bbmcap = "data/pump_buybacks_vs_mcap.json"
with open(out_bbmcap, "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "cum_buybacks_usd": None if pd.isna(bu) else float(bu),
                "mcap_usd": None if pd.isna(mc) else float(mc),
                "pct_bought": None if pd.isna(pb) else float(pb),
            }
            for d, bu, mc, pb in zip(
                df_core["date"], df_core["cum_buybacks_usd"], df_core["mcap_usd"], df_core["pct_bought"]
            )
        ]
    }, f, indent=2)
print(f"wrote {out_bbmcap} rows:", len(df_core))

    }, f, indent=2)
print(f"wrote {out_bbmcap} rows:", len(df_core))
