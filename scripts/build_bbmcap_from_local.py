#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
from datetime import datetime


def read_series(path, key_map):
    with open(path, "r") as f:
        data = json.load(f)
    series = data.get("series", [])
    out = []
    for row in series:
        d = {
            "date": row.get("date"),
            "price": row.get("price") or row.get("price_usd"),
        }
        # remap input keys if needed
        for dest, srcs in key_map.items():
            for s in ([dest] + srcs):
                if s in row and row[s] is not None:
                    d[dest] = row[s]
                    break
        out.append(d)
    return out


def main():
    os.makedirs("data", exist_ok=True)

    # inputs
    pbb_path = os.path.join("data", "pump_price_buybacks_usd.json")
    if not os.path.exists(pbb_path):
        raise SystemExit(f"Missing input: {pbb_path}")

    price_buybacks = read_series(
        pbb_path,
        key_map={"buybacks_usd": ["buybacks", "buybacks_native_usd", "buybacks_native"]},
    )

    circ_supply = os.environ.get("CIRC_SUPPLY")
    circ_supply = float(circ_supply) if circ_supply else None

    out = []
    cum = 0.0
    for row in sorted(price_buybacks, key=lambda r: r.get("date") or ""):
        # parse date to normalize format
        try:
            dt = datetime.strptime(row["date"], "%Y-%m-%d")
        except Exception:
            # try other formats
            try:
                dt = datetime.fromisoformat(row["date"])  # may contain time
            except Exception:
                continue
        price = row.get("price")
        bb = row.get("buybacks_usd") or 0.0
        try:
            bb = float(bb)
        except Exception:
            bb = 0.0
        cum += bb

        mcap_usd = None
        pct_bought = None
        if circ_supply and price is not None:
            try:
                mcap_usd = float(price) * float(circ_supply)
                pct_bought = (cum / mcap_usd) if mcap_usd else None
            except Exception:
                pass

        out.append({
            "date": dt.strftime("%Y-%m-%d"),
            "cum_buybacks_usd": round(cum, 6),
            "mcap_usd": None if mcap_usd is None else round(mcap_usd, 6),
            "pct_bought": None if pct_bought is None else pct_bought,
        })

    out_path = os.path.join("data", "pump_mcap_buybacks.json")
    with open(out_path, "w") as f:
        json.dump({"series": out}, f, indent=2)
    print("wrote", out_path, "rows:", len(out))


if __name__ == "__main__":
    main()

