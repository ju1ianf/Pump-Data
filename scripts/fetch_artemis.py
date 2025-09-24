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
