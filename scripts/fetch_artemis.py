import os, json, pandas as pd
from datetime import date, timedelta
from artemis import Artemis

API = Artemis(api_key=os.environ["ARTEMIS_API_KEY"])
ASSET = "pump"

# Rolling ~70 days so you don’t have to hardcode
END = date.today()
START = END - timedelta(days=70)
START, END = START.isoformat(), END.isoformat()

def to_df_vals(rows, colname):
    """
    Convert Artemis rows -> tidy df(date, <colname>), coercing bad values to NaN.
    Handles either {t, v} or {timestamp, val} shapes.
    """
    import pandas as pd

    if not rows:
        return pd.DataFrame(columns=["date", colname])

    df = pd.DataFrame(rows)

    # Normalize value column: prefer 'v', else 'val'
    if "v" in df.columns:
        df = df.rename(columns={"v": colname})
    elif "val" in df.columns:
        df = df.rename(columns={"val": colname})
    else:
        df[colname] = pd.NA  # create empty column if missing

    # Normalize date column: prefer 't' (ms), else 'timestamp'
    if "t" in df.columns:
        df["date"] = (
            pd.to_datetime(df["t"], unit="ms")
              .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize()
        )
    elif "timestamp" in df.columns:
        df["date"] = (
            pd.to_datetime(df["timestamp"])
              .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize()
        )
    elif "date" in df.columns and not pd.api.types.is_datetime64_any_dtype(df["date"]):
        df["date"] = pd.to_datetime(df["date"], errors="coerce")

    # Coerce metric values (e.g. "METRIC NOT FOUND" → NaN)
    if colname in df.columns:
        df[colname] = pd.to_numeric(df[colname], errors="coerce")
    else:
        df[colname] = pd.NA

    return df[["date", colname]]


# ---------- 1) PUMP: Price + Fees -> data/pump.json ----------
resp = API.fetch_metrics(metric_names="price,fees",
                         symbols=ASSET, start_date=START, end_date=END)
sym = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

df_price = to_df_vals(sym["price"], "price")
df_fees  = to_df_vals(sym["fees"],  "fees")
df_pf = pd.merge(df_price, df_fees, on="date", how="outer").sort_values("date")

os.makedirs("data", exist_ok=True)
with open("data/pump.json", "w") as f:
    json.dump({"series":[
        {"date": d.strftime("%Y-%m-%d"),
         "price": None if pd.isna(p) else float(p),
         "fees":  None if pd.isna(x) else float(x)}
        for d,p,x in zip(df_pf["date"], df_pf["price"], df_pf["fees"])
    ]}, f, indent=2)
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

df_price_r = to_df_vals(sym_rev["price"], "price")
df_rev     = to_df_vals(sym_rev[used_key], "revenue")  # normalize column name
df_pr = pd.merge(df_price_r, df_rev, on="date", how="outer").sort_values("date")

with open("data/pump_price_revenue.json", "w") as f:
    json.dump({"series":[
        {"date": d.strftime("%Y-%m-%d"),
         "price": None if pd.isna(p) else float(p),
         "revenue": None if pd.isna(rv) else float(rv)}
        for d,p,rv in zip(df_pr["date"], df_pr["price"], df_pr["revenue"])
    ]}, f, indent=2)
print("wrote data/pump_price_revenue.json using metric:", used_key, "rows:", len(df_pr))

# -------- 3) PUMP: Price + Buybacks (Native) -> Buybacks (USD) --------
# Fetch both series together so they're aligned on dates
resp = API.fetch_metrics(
    metric_names="price,buybacks_native",
    symbols=ASSET,
    start_date=START,
    end_date=END
)
sym_bb = (resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__)["data"]["symbols"][ASSET]

def to_df_vals(rows, colname):
    """
    Convert Artemis rows -> tidy df(date, value), coercing bad values to NaN.
    Handles:
      - value column: 'val' (or falls back to 'v' if ever used)
      - time column: 't' (ms) or 'timestamp'
      - strings like 'METRIC NOT FOUND' -> NaN
    """
    import pandas as pd

    if not rows:
        return pd.DataFrame(columns=["date", colname])

    df = pd.DataFrame(rows)

    # Normalize value column
    if "val" in df.columns:
        df = df.rename(columns={"val": colname})
    elif "v" in df.columns:
        df = df.rename(columns={"v": colname})
    else:
        # If there's no recognizable value column, return empty
        return pd.DataFrame(columns=["date", colname])

    # Normalize time column
    if "t" in df.columns:
        df["date"] = (pd.to_datetime(df["t"], unit="ms")
                        .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize())
    elif "timestamp" in df.columns:
        df["date"] = (pd.to_datetime(df["timestamp"])
                        .dt.tz_localize("UTC").dt.tz_convert(None).dt.normalize())
    else:
        # No time column -> empty
        return pd.DataFrame(columns=["date", colname])

    # Coerce numeric values; non-numeric (e.g., 'METRIC NOT FOUND') -> NaN
    df[colname] = pd.to_numeric(df[colname], errors="coerce")

    return df[["date", colname]]

# Build tidy frames
df_price       = to_df_vals(sym_bb.get("price", []),            "price")
df_bb_native   = to_df_vals(sym_bb.get("buybacks_native", []),  "buybacks_native")

# Outer join on date so we never drop a day; sort by time
df_pbb = (pd.merge(df_price, df_bb_native, on="date", how="outer")
            .sort_values("date")
            .reset_index(drop=True))

# Your rule: when buybacks_native is missing, use previous day's value
df_pbb["buybacks_native"] = df_pbb["buybacks_native"].ffill()

# Convert to USD: native * price
df_pbb["buybacks_usd"] = df_pbb["buybacks_native"] * df_pbb["price"]

# Write JSON for the frontend
os.makedirs("data", exist_ok=True)
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


