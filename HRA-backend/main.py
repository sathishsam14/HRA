#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HRA Python Backend API
======================
Exposes the BTC Hybrid Rating-Change Recommender (Rule + Scikit-Learn + Text Mining)
as a high-performance REST service for the Next.js frontend.
"""

import os
import re
import json
import shutil
import tempfile
from datetime import datetime
from typing import Optional, List, Dict, Any
import numpy as np
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from btc_rating_model import (
    load_bsm,
    load_bwm,
    mine_reports,
    build_features,
    RatingModel,
    justify,
    FLAGS,
    FLAG_GROUP_OF,
)

app = FastAPI(title="BTC Rating Engine Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MASTER_DIR = os.getenv("MASTER_DIR", os.path.join(BASE_DIR, "data"))
ARCHIVE_DIR = os.getenv("ARCHIVE_DIR", os.path.join(MASTER_DIR, "archive"))
DEFAULT_BSM_PATH = os.path.join(MASTER_DIR, "BSM.xlsx")
CONFIRMED_RACES_PATH = os.path.join(MASTER_DIR, "confirmed_races.json")

# In-memory caches for instant (~30ms) responses
_cached_bsm = None
_cached_model = None
_training_info = {}


def load_confirmed_races_as_df() -> pd.DataFrame:
    """Loads confirmed handicapper decisions and formats them as BSM historical rows."""
    if not os.path.exists(CONFIRMED_RACES_PATH):
        return pd.DataFrame()
    try:
        with open(CONFIRMED_RACES_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
        if not records or not isinstance(records, list):
            return pd.DataFrame()

        rows = []
        for race in records:
            r_date = pd.to_datetime(race.get("race_date"), errors="coerce")
            season = race.get("season", "2026-27")
            cat = race.get("category", "00-25")
            raceno = race.get("race_no", 1)
            dist = race.get("distance", 1200)

            for entry in race.get("entries", []):
                h_name = str(entry.get("horse_name", "")).strip()
                if not h_name:
                    continue
                rows.append({
                    "d": r_date,
                    "season": season,
                    "cat": cat,
                    "raceno": raceno,
                    "dist": dist,
                    "rating": entry.get("current_rating"),
                    "horse": h_name,
                    "hw": entry.get("horse_weight"),
                    "shoe": entry.get("shoes", "A"),
                    "gate": entry.get("gate"),
                    "jockey": entry.get("jockey", "Unknown"),
                    "place": entry.get("placing"),
                    "timing": entry.get("timing"),
                    "verdict": entry.get("verdict"),
                    "chg": entry.get("confirmed_change", 0),  # Official confirmed decision
                    "trainer": entry.get("trainer", "Unknown"),
                    "pent": entry.get("penetrometer", ""),
                    "rail": entry.get("railing", "original position"),
                    "is_target": False,
                    "src_row": 0,
                })
        return pd.DataFrame(rows)
    except Exception as e:
        print(f"⚠️ [BACKEND] Error loading confirmed races: {e}")
        return pd.DataFrame()


def sync_master_from_ftp_if_configured():
    """
    Checks FTP for BSM master file if FTP is configured in env (FTP_HOST).
    If FTP is not configured or connection fails, falls back gracefully to
    the local file stored under HRA-backend/data/BSM.xlsx.
    """
    ftp_host = os.getenv("FTP_HOST")
    if not ftp_host:
        print(f"ℹ️ [BACKEND] FTP not configured / inactive. Using local master file at {DEFAULT_BSM_PATH}")
        return

    try:
        import ftplib
        ftp_user = os.getenv("FTP_USER", "anonymous")
        ftp_pass = os.getenv("FTP_PASS", "")
        ftp_path = os.getenv("FTP_MASTER_PATH", "BSM.xlsx")
        print(f"📡 [BACKEND] Connecting to FTP ({ftp_host}) to sync master data...")
        with ftplib.FTP(ftp_host, timeout=5) as ftp:
            ftp.login(user=ftp_user, passwd=ftp_pass)
            os.makedirs(MASTER_DIR, exist_ok=True)
            with open(DEFAULT_BSM_PATH, "wb") as f:
                ftp.retrbinary(f"RETR {ftp_path}", f.write)
            print(f"✅ [BACKEND] Successfully downloaded master data from FTP to {DEFAULT_BSM_PATH}")
    except Exception as e:
        print(f"⚠️ [BACKEND] FTP sync failed ({e}). Falling back to local master file at {DEFAULT_BSM_PATH}")


def get_base_data_and_model(force_reload: bool = False):
    global _cached_bsm, _cached_model, _training_info
    if _cached_bsm is None or force_reload:
        sync_master_from_ftp_if_configured()
    if (_cached_bsm is None or force_reload) and os.path.exists(DEFAULT_BSM_PATH):
        print(f"📂 [BACKEND] Loading baseline historical BSM dataset from {DEFAULT_BSM_PATH}...")
        raw_bsm = load_bsm(DEFAULT_BSM_PATH)
        confirmed_df = load_confirmed_races_as_df()

        if not confirmed_df.empty:
            print(f"📈 [BACKEND] Augmenting training set with {len(confirmed_df)} confirmed handicapper runs...")
            _cached_bsm = pd.concat([raw_bsm, confirmed_df], ignore_index=True)
            _cached_bsm["horse"] = _cached_bsm["horse"].astype(str).str.strip()
        else:
            _cached_bsm = raw_bsm

        print(f"⚡ [BACKEND] Training hybrid RatingModel on {len(_cached_bsm)} total historical runs...")
        feat = build_features(_cached_bsm, None)
        _cached_model = RatingModel(use_text=True).fit(feat[~feat["is_target"]])

        valid_dates = _cached_bsm["d"].dropna()
        min_date = str(valid_dates.min().date()) if not valid_dates.empty else "N/A"
        max_date = str(valid_dates.max().date()) if not valid_dates.empty else "N/A"

        _training_info = {
            "master_entries": len(_cached_bsm),
            "baseline_bsm_entries": len(raw_bsm),
            "confirmed_entries_incorporated": len(confirmed_df),
            "min_date": min_date,
            "max_date": max_date,
            "trained_at": datetime.now().isoformat(),
        }
        print(f"✅ [BACKEND] Hybrid RatingModel ready! ({len(_cached_bsm)} entries, {min_date} to {max_date})")

    return _cached_bsm, _cached_model


@app.on_event("startup")
def startup_event():
    get_base_data_and_model()


@app.post("/api/upload-master")
async def upload_master(file: UploadFile = File(...)):
    """
    Validates the uploaded file for corruption before applying.
    Saves the uploaded file as the current master in MASTER_DIR.
    Archives previous master to ARCHIVE_DIR with timestamp.
    Reloads and retrains the Python hybrid model.
    """
    os.makedirs(MASTER_DIR, exist_ok=True)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    contents = await file.read()
    if not contents or len(contents) == 0:
        raise HTTPException(status_code=400, detail="Corrupted or empty file: uploaded file contains 0 bytes.")

    # 1. Write to temporary file to test for corruption BEFORE touching active master
    temp_path = os.path.join(MASTER_DIR, f"temp_upload_{datetime.now().timestamp()}.xlsx")
    try:
        with open(temp_path, "wb") as f:
            f.write(contents)

        # Test corruption and validate structure
        test_df = load_bsm(temp_path)
        if test_df is None or test_df.empty:
            raise ValueError("File contains no valid historical race rows.")
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(
            status_code=400,
            detail=f"Corruption detected in Master file: {str(e)}. Existing master dataset was preserved."
        )

    # 2. Archive previous master if valid
    archived_filename = None
    if os.path.exists(DEFAULT_BSM_PATH):
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archived_filename = f"BSM_{ts}.xlsx"
        archived_path = os.path.join(ARCHIVE_DIR, archived_filename)
        shutil.move(DEFAULT_BSM_PATH, archived_path)
        print(f"📦 [BACKEND] Archived previous master to: {archived_path}")

    # 3. Promote validated temp file to current master
    shutil.move(temp_path, DEFAULT_BSM_PATH)
    print(f"💾 [BACKEND] Promoted new validated master BSM to: {DEFAULT_BSM_PATH} ({len(contents)} bytes)")

    bsm, model = get_base_data_and_model(force_reload=True)

    return {
        "success": True,
        "message": "Master history verified, updated and rating model retrained successfully.",
        "master_entries": len(bsm) if bsm is not None else 0,
        "archived_as": archived_filename,
        "training_info": _training_info,
    }


@app.post("/api/sync-confirmed-race")
def sync_confirmed_race(payload: Dict[str, Any]):
    """
    Receives confirmed handicapper decisions for a race, persists them,
    and updates the training dataset so the model continuously learns.
    """
    os.makedirs(MASTER_DIR, exist_ok=True)
    all_confirmed = []
    if os.path.exists(CONFIRMED_RACES_PATH):
        try:
            with open(CONFIRMED_RACES_PATH, "r", encoding="utf-8") as f:
                all_confirmed = json.load(f)
                if not isinstance(all_confirmed, list):
                    all_confirmed = []
        except:
            all_confirmed = []

    # Replace existing record for this race if already present, or append
    venue = payload.get("venue", "BNG")
    r_date = payload.get("race_date")
    r_no = payload.get("race_no")

    all_confirmed = [
        r for r in all_confirmed
        if not (r.get("venue") == venue and r.get("race_date") == r_date and r.get("race_no") == r_no)
    ]
    all_confirmed.append(payload)

    with open(CONFIRMED_RACES_PATH, "w", encoding="utf-8") as f:
        json.dump(all_confirmed, f, indent=2)

    # Retrain model with newly confirmed race
    get_base_data_and_model(force_reload=True)

    return {
        "success": True,
        "message": f"Confirmed decisions for {venue} Race #{r_no} incorporated into model training.",
        "total_confirmed_races": len(all_confirmed),
    }


@app.get("/api/model-info")
def get_model_info():
    """Returns metadata about the active training set, entries count, and dates."""
    bsm, _ = get_base_data_and_model()
    is_loaded = bsm is not None and not bsm.empty
    return {
        "success": True,
        "master_data_loaded": is_loaded,
        "master_entries": len(bsm) if is_loaded else 0,
        "training_info": _training_info,
    }


class EntrantPayload(BaseModel):
    entry_id: Optional[int] = None
    horse_name: str
    current_rating: Optional[float] = None
    placing: Optional[int] = None
    timing: Optional[str] = None
    verdict: Optional[Any] = None
    weight_carried: Optional[float] = None
    horse_weight: Optional[float] = None
    shoes: Optional[str] = None
    gate: Optional[int] = None
    jockey: Optional[str] = None
    trainer: Optional[str] = None
    starter_remark: Optional[str] = None
    vet_remark: Optional[str] = None
    incident_remark: Optional[str] = None


class RacePayload(BaseModel):
    venue: Optional[str] = "BNG"
    race_date: str
    season: Optional[str] = "2026-27"
    category: str
    race_no: int
    distance: int
    penetrometer: Optional[str] = None
    railing: Optional[str] = None
    entries: List[EntrantPayload]


@app.get("/health")
def health():
    bsm, model = get_base_data_and_model()
    is_loaded = bsm is not None and not bsm.empty and model is not None
    return {
        "status": "ok",
        "service": "BTC Rating Backend",
        "master_data_loaded": is_loaded,
        "master_entries": len(bsm) if is_loaded else 0,
    }


@app.get("/api/accuracy")
def get_model_accuracy(split: str = "2026-05-01"):
    """
    Returns chronological hold-out validation metrics for the BTC hybrid model.
    """
    bsm, _ = get_base_data_and_model()
    if bsm is None:
        raise HTTPException(status_code=500, detail="Master history dataset is not loaded.")

    try:
        feat = build_features(bsm, None)
        tr = feat[(~feat["is_target"]) & (feat["d"] < split)]
        te = feat[(~feat["is_target"]) & (feat["d"] >= split) & feat["runner"] & feat["y"].notna() & (feat["rat"] > 0)]

        from btc_rating_model import RuleTable
        rule = RuleTable().fit(tr[tr["runner"] & tr["y"].notna()])
        te = te.copy()
        te["base"] = rule.base(te)

        m = RatingModel(use_text=True).fit(tr[tr["runner"]])
        pred = m.predict(te)["rec"]
        err = pred.values - te["y"].values

        mae = float(np.abs(err).mean())
        exact_pct = float(np.mean(err == 0) * 100)
        within1_pct = float(np.mean(np.abs(err) <= 1) * 100)
        within2_pct = float(np.mean(np.abs(err) <= 2) * 100)

        return {
            "success": True,
            "train_count": len(tr),
            "test_count": len(te),
            "split_date": split,
            "mae": round(mae, 2),
            "exact_pct": round(exact_pct, 1),
            "within1_pct": round(within1_pct, 1),
            "within2_pct": round(within2_pct, 1),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/predict-race")
def predict_race(payload: RacePayload):
    """
    Direct JSON API used by Next.js to rate entrants of an open race in the database.
    """
    bsm, model = get_base_data_and_model()
    if bsm is None or model is None:
        raise HTTPException(
            status_code=500,
            detail="Historical BSM master dataset is not loaded.",
        )

    try:
        r_date = pd.to_datetime(payload.race_date, errors="coerce")
        bwm_rows = []
        ev_rows = []

        for idx, entry in enumerate(payload.entries):
            h_name = entry.horse_name.strip()
            bwm_rows.append({
                "d": r_date,
                "season": payload.season or "2026-27",
                "cat": payload.category,
                "raceno": payload.race_no,
                "dist": payload.distance,
                "rating": entry.current_rating,
                "horse": h_name,
                "hw": entry.horse_weight,
                "shoe": entry.shoes or "A",
                "gate": entry.gate,
                "jockey": entry.jockey or "Unknown",
                "place": entry.placing,
                "timing": entry.timing,
                "verdict": entry.verdict,
                "chg": np.nan,
                "trainer": entry.trainer or "Unknown",
                "pent": payload.penetrometer or "",
                "rail": payload.railing or "original position",
                "is_target": True,
                "src_row": idx,
            })

            remarks = [
                ("starter", entry.starter_remark),
                ("vet", entry.vet_remark),
                ("incident", entry.incident_remark),
            ]
            for src, txt in remarks:
                if not txt:
                    continue
                for fl, rg in FLAGS:
                    if rg.search(txt):
                        ev_rows.append({
                            "horse": h_name,
                            "date": pd.Timestamp(r_date),
                            "raceno": payload.race_no,
                            "flag": fl,
                            "source": src,
                            "text": txt[:400],
                        })

        bwm = pd.DataFrame(bwm_rows)
        ev = pd.DataFrame(ev_rows) if ev_rows else pd.DataFrame(columns=["horse", "date", "raceno", "flag", "source", "text"])
        ev.attrs["days"] = [pd.Timestamp(r_date)] if not ev.empty else []

        all_rows = pd.concat([bsm, bwm], ignore_index=True)
        all_rows["horse"] = all_rows["horse"].str.strip()
        feat = build_features(all_rows, ev)

        tgt = feat[feat["is_target"]].copy()
        tgt = model.predict(tgt)
        tgt["text_eff"] = model.text_effect(tgt)
        tgt["rule_base"] = model.rule.base(tgt)
        tgt = tgt.sort_values("src_row")

        ev_by_h = {h: g for h, g in ev.groupby("horse")} if len(ev) else {}

        results = []
        for i, (_, r) in enumerate(tgt.iterrows()):
            eh = ev_by_h.get(r["horse"])
            if eh is not None:
                eh = eh[(eh["date"] < r["d"]) & (eh["date"] >= r["d"] - pd.Timedelta(days=365))]

            j = justify(r, eh, r["text_eff"], r["rule_base"])
            rec_chg = 0 if not r["runner"] else int(r["rec"])
            cur_rat = None if pd.isna(r["rating"]) else int(r["rating"])
            new_rat = cur_rat if not r["runner"] else (None if cur_rat is None else int(max(0, cur_rat + rec_chg)))

            orig_entry = payload.entries[i] if i < len(payload.entries) else None

            results.append({
                "entry_id": orig_entry.entry_id if orig_entry else None,
                "horse_name": r["horse"],
                "placing": int(r["place"]) if pd.notna(r["place"]) else None,
                "current_rating": cur_rat,
                "recommended_change": rec_chg,
                "recommended_rating": new_rat,
                "justification": j,
                "status": "RATED" if r["runner"] else "UNCHANGED",
            })

        return {
            "success": True,
            "race_no": payload.race_no,
            "total_horses": len(results),
            "ratings": results,
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/rate")
async def rate_meeting(
    race_file: UploadFile = File(...),
    history_file: Optional[UploadFile] = File(None),
    stipe_file: Optional[UploadFile] = File(None),
    vet_file: Optional[UploadFile] = File(None),
    starter_file: Optional[UploadFile] = File(None),
    incidence_file: Optional[UploadFile] = File(None),
):
    """
    Rates an uploaded Current Race meeting (e.g. BWM.xlsx) using the exact
    BTC hybrid model, incorporating any uploaded Stipe, Vet, Starter, and
    Incidence reports.
    """
    temp_dir = tempfile.mkdtemp()
    try:
        bwm_path = os.path.join(temp_dir, race_file.filename)
        with open(bwm_path, "wb") as f:
            f.write(await race_file.read())

        if history_file is not None and history_file.filename:
            bsm_path = os.path.join(temp_dir, history_file.filename)
            with open(bsm_path, "wb") as f:
                f.write(await history_file.read())
            bsm = load_bsm(bsm_path)
            all_rows_for_model = build_features(bsm, None)
            model = RatingModel(use_text=True).fit(all_rows_for_model[~all_rows_for_model["is_target"]])
        elif os.path.exists(DEFAULT_BSM_PATH):
            bsm, model = get_base_data_and_model()
        else:
            raise HTTPException(
                status_code=400,
                detail="Master history file (BSM.xlsx) not provided and default not found.",
            )

        report_paths = {"stewards": None, "vet": None, "starter": None, "incident": None}

        if stipe_file and stipe_file.filename:
            p = os.path.join(temp_dir, stipe_file.filename)
            with open(p, "wb") as f:
                f.write(await stipe_file.read())
            report_paths["stewards"] = p

        if vet_file and vet_file.filename:
            p = os.path.join(temp_dir, vet_file.filename)
            with open(p, "wb") as f:
                f.write(await vet_file.read())
            report_paths["vet"] = p

        if starter_file and starter_file.filename:
            p = os.path.join(temp_dir, starter_file.filename)
            with open(p, "wb") as f:
                f.write(await starter_file.read())
            report_paths["starter"] = p

        if incidence_file and incidence_file.filename:
            p = os.path.join(temp_dir, incidence_file.filename)
            with open(p, "wb") as f:
                f.write(await incidence_file.read())
            report_paths["incident"] = p

        bwm = load_bwm(bwm_path)
        names = set(bsm["horse"].dropna().str.strip()) | set(bwm["horse"].str.strip())
        ev = mine_reports(report_paths, names)

        all_rows = pd.concat([bsm, bwm], ignore_index=True)
        all_rows["horse"] = all_rows["horse"].str.strip()
        feat = build_features(all_rows, ev)

        tgt = feat[feat["is_target"]].copy()
        tgt = model.predict(tgt)
        tgt["text_eff"] = model.text_effect(tgt)
        tgt["rule_base"] = model.rule.base(tgt)
        tgt = tgt.sort_values("src_row")

        ev_by_h = {h: g for h, g in ev.groupby("horse")} if len(ev) else {}

        results = []
        for _, r in tgt.iterrows():
            eh = ev_by_h.get(r["horse"])
            if eh is not None:
                eh = eh[(eh["date"] < r["d"]) & (eh["date"] >= r["d"] - pd.Timedelta(days=365))]

            j = justify(r, eh, r["text_eff"], r["rule_base"])
            rec_chg = 0 if not r["runner"] else int(r["rec"])
            cur_rat = None if pd.isna(r["rating"]) else int(r["rating"])
            new_rat = cur_rat if not r["runner"] else (None if cur_rat is None else int(max(0, cur_rat + rec_chg)))

            results.append({
                "horse": r["horse"],
                "race_date": str(r["d"].date()) if pd.notna(r["d"]) else None,
                "raceno": int(r["raceno"]) if pd.notna(r["raceno"]) else None,
                "placing": int(r["place"]) if pd.notna(r["place"]) else None,
                "current_rating": cur_rat,
                "recommended_change": rec_chg,
                "proposed_new_rating": new_rat,
                "justification": j,
                "is_runner": bool(r["runner"]),
            })

        evidence = []
        bw_h = set(bwm["horse"].str.strip())
        if not ev.empty:
            for _, e in ev[ev["horse"].isin(bw_h)].sort_values(["horse", "date"]).iterrows():
                evidence.append({
                    "horse": e["horse"],
                    "date": str(e["date"].date()),
                    "source": e["source"],
                    "flag": e["flag"],
                    "remark": e["text"],
                })

        return {
            "success": True,
            "total_horses": len(results),
            "results": results,
            "report_evidence": evidence,
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
