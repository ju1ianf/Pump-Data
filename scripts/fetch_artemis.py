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


# ---------- 4) PUMP: Cumulative Buybacks vs Circulating Market Cap ----------
# Reuse the daily price and buybacks we already fetched/built above (df_pbb has date, price, buybacks_native, buybacks_usd)

# 4.1 Fetch circulating market cap (or compute as circulating_supply * price if needed)
def try_fetch_metric_single(metric_candidates):
    for name in metric_candidates:
        try:
            r = API.fetch_metrics(metric_names=f"price,{name}", symbols=ASSET,
                                  start_date=START, end_date=END)
            d = (r.model_dump() if hasattr(r, "model_dump") else r.__dict__)["data"]["symbols"][ASSET]
            if name in d:
                return d, name
        except Exception:
            pass
    return None, None

mcap_candidates = [
    "circulating_market_cap",
    "market_cap_circulating",
    "marketcap_circulating",
    "mcap_circulating",
    "market_cap"  # fallback if it's actually circulating
]

sym_mc, used_mcap_key = try_fetch_metric_single(mcap_candidates)

if sym_mc is not None:
    df_mc = to_df_vals(sym_mc[used_mcap_key], "mcap_usd")
else:
    # Fallback: compute market cap = circulating_supply * price if supply is available
    try:
        r = API.fetch_metrics(metric_names="price,circulating_supply", symbols=ASSET,
                              start_date=START, end_date=END)
        d = (r.model_dump() if hasattr(r, "model_dump") else r.__dict__)["data"]["symbols"][ASSET]
        df_price2 = to_df_vals(d.get("price", []), "price")
        df_supply = to_df_vals(d.get("circulating_supply", []), "circ_supply")
        df_mc = pd.merge(df_price2, df_supply, on="date", how="outer").sort_values("date")
        df_mc["mcap_usd"] = df_mc["price"] * df_mc["circ_supply"]
        df_mc = df_mc[["date", "mcap_usd"]]
        used_mcap_key = "computed(price * circulating_supply)"
    except Exception as e:
        raise RuntimeError("Could not obtain circulating market cap (or supply).") from e

# 4.2 Build cumulative buybacks USD
df_pbb2 = df_pbb.copy()
df_pbb2 = df_pbb2.sort_values("date")
df_pbb2["cum_buybacks_usd"] = df_pbb2["buybacks_usd"].fillna(0).cumsum()

# 4.3 Merge with market cap and compute % of supply bought
df_bm = pd.merge(df_pbb2[["date", "cum_buybacks_usd"]], df_mc, on="date", how="outer").sort_values("date")
# forward-fill market cap gaps if any (optional)
df_bm["mcap_usd"] = df_bm["mcap_usd"].ffill()
# percent retired so far
df_bm["pct_bought"] = (df_bm["cum_buybacks_usd"] / df_bm["mcap_usd"]).where(df_bm["mcap_usd"] > 0)

# 4.4 Write JSON
out_file = "data/pump_buybacks_vs_mcap.json"
os.makedirs("data", exist_ok=True)
with open(out_file, "w") as f:
    json.dump({
        "series": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "cum_buybacks_usd": None if pd.isna(cb) else float(cb),
                "mcap_usd": None if pd.isna(mc) else float(mc),
                "pct_bought": None if pd.isna(p) else float(p)
            }
            for d, cb, mc, p in zip(df_bm["date"], df_bm["cum_buybacks_usd"], df_bm["mcap_usd"], df_bm["pct_bought"])
        ]
    }, f, indent=2)
print(f"wrote {out_file} using market cap key: {used_mcap_key} rows:", len(df_bm))


