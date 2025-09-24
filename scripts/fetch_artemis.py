import os, json, pandas as pd
from artemis import Artemis

API = Artemis(api_key=os.environ["ARTEMIS_API_KEY"])

ASSET = "pump"
START = "2025-07-15"
END   = "2025-09-23"

# price + fees for the date range
resp = API.fetch_metrics(
    metric_names="price,fees",
    symbols=ASSET,
    start_date=START,
    end_date=END
)

payload = resp.model_dump() if hasattr(resp, "model_dump") else resp.__dict__
sym = payload["data"]["symbols"][ASSET]

def to_df(rows, name):
    if not rows:
        return pd.DataFrame(columns=["date", name])
    df = pd.DataFrame(rows).rename(columns={"val": name})
    df["date"] = pd.to_datetime(df.get("date", df.get("timestamp")))
    return df[["date", name]]

df = to_df(sym["price"], "price").merge(
     to_df(sym["fees"],  "fees"), on="date", how="outer"
).sort_values("date")

out = {"series": [
    {"date": d.strftime("%Y-%m-%d"),
     "price": None if pd.isna(p) else float(p),
     "fees":  None if pd.isna(f) else float(f)}
    for d, p, f in zip(df["date"], df["price"], df["fees"])
]}

os.makedirs("data", exist_ok=True)
with open("data/pump.json", "w") as f:
    json.dump(out, f, indent=2)
print("wrote data/pump.json with", len(out["series"]), "rows")


# ---- 2) Price + Revenue (tries common aliases) ----
def try_fetch_price_and(metric_name: str):
    r = API.fetch_metrics(metric_names=f"price,{metric_name}",
                          symbols=ASSET, start_date=START, end_date=END)
    p = r.model_dump() if hasattr(r,"model_dump") else r.__dict__
    return p["data"]["symbols"][ASSET]

REV_ALIASES = ["revenue", "protocol_revenue", "revenue_usd"]

sym_rev = None
used_key = None
for key in REV_ALIASES:
    try:
        cand = try_fetch_price_and(key)
        if key in cand:
            sym_rev, used_key = cand, key
            break
    except Exception:
        pass

if sym_rev is None:
    # If your API exposes revenue as fees, uncomment the next two lines:
    # cand = try_fetch_price_and("fees")
    # sym_rev, used_key = cand, "fees"
    raise RuntimeError("Could not find a revenue metric. Update REV_ALIASES or enable the fees fallback.")

df_price_r = to_df(sym_rev["price"], "price")
df_revenue  = to_df(sym_rev[used_key], "revenue")  # normalize to 'revenue'

df_pr = pd.merge(df_price_r, df_revenue, on="date", how="outer").sort_values("date")

os.makedirs("data", exist_ok=True)
with open("data/pump_price_revenue.json","w") as f:
    json.dump({
        "series":[
            {"date": d.strftime("%Y-%m-%d"),
             "price": None if pd.isna(p) else float(p),
             "revenue": None if pd.isna(rv) else float(rv)}
            for d,p,rv in zip(df_pr["date"], df_pr["price"], df_pr["revenue"])
        ]
    }, f, indent=2)
print("wrote data/pump_price_revenue.json with", len(df_pr), "rows (metric used:", used_key, ")")

