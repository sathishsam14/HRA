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
import hashlib
import shutil
import struct
import tempfile
from datetime import datetime
from typing import Optional, List, Dict, Any
import numpy as np
import pandas as pd
import docx
import olefile
from pypdf import PdfReader
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from btc_rating_model import (
    load_bsm,
    load_bwm,
    mine_reports,
    build_features,
    RatingModel,
    justify,
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
REPORTS_DIR = os.getenv("REPORTS_DIR", os.path.join(MASTER_DIR, "reports"))
DEFAULT_BSM_PATH = os.path.join(MASTER_DIR, "BSM.xlsx")
CONFIRMED_RACES_PATH = os.path.join(MASTER_DIR, "confirmed_races.json")
MODEL_FILE_PATH = os.path.join(BASE_DIR, "btc_rating_model.py")

REPORT_SOURCES = ["stewards", "vet", "starter", "incident"]
REPORT_TYPE_MAP = {
    "STIPE": "stewards",
    "STEWARDS": "stewards",
    "VETERINARY": "vet",
    "VET": "vet",
    "STARTER": "starter",
    "INCIDENT": "incident",
    "INCIDENCE": "incident",
}

# In-memory caches for instant (~30ms) responses
_cached_bsm = None
_cached_model = None
_cached_ev = None
_cached_raw_bsm_rows = None
_training_info = {}


def is_use_confirmed_races_enabled() -> bool:
    val = os.getenv("USE_CONFIRMED_RACES", "true").strip().lower()
    return val not in ("false", "0", "no", "off")


def get_model_file_sha256() -> str:
    try:
        h = hashlib.sha256()
        with open(MODEL_FILE_PATH, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return "unknown"


def validate_bsm_file(path: str):
    """Validates BSM.xlsx structure BEFORE calling client's load_bsm()."""
    expected_cols = 22
    try:
        b = pd.read_excel(path)
    except Exception as e:
        raise ValueError(f"Corrupted Excel file: unable to read workbook from {path} ({e})")

    if b.empty:
        raise ValueError(f"Corrupted or empty file: no data rows found in {path}")

    if b.shape[1] != expected_cols:
        raise ValueError(
            f"Corrupted file: expected {expected_cols} columns in BSM, but file has {b.shape[1]}"
        )

    parsed_dates = pd.to_datetime(b.iloc[:, 1], format="%d/%m/%Y", errors="coerce")
    if parsed_dates.isna().all():
        raise ValueError("Corrupted file: no valid dd/mm/yyyy race dates found in 'date' column.")


def validate_bwm_file(path: str):
    """Validates BWM.xlsx structure BEFORE calling client's load_bwm()."""
    required = [
        "racedate", "raceseason", "racecat", "raceno", "distance",
        "currat", "HorseName", "horswgt", "shoe", "startstall",
        "jockey", "placing", "Timing", "Verdict", "trainer",
        "pent", "Railing Position",
    ]
    try:
        w = pd.read_excel(path)
    except Exception as e:
        raise ValueError(f"Corrupted Excel file: unable to read workbook from {path} ({e})")

    if w.empty:
        raise ValueError(f"Corrupted or empty file: no rows found in {path}")

    missing = [c for c in required if c not in w.columns]
    if missing:
        raise ValueError(f"Corrupted file: missing required BWM columns: {', '.join(missing)}")

    if w["HorseName"].isna().all():
        raise ValueError("Corrupted file: missing or empty 'HorseName' column.")


def _extract_doc_text_pure_python(src_path: str) -> List[str]:
    """
    Pure-Python, cross-platform .doc (OLE2 Word 97-2003) text extractor using olefile.
    Reads the WordDocument FIB + Clx piece table when available, falling back to
    printable text extraction from the WordDocument stream.
    """
    if not olefile.isOleFile(src_path):
        raise ValueError("File is not a valid binary .doc (OLE2) document.")

    with olefile.OleFileIO(src_path) as ole:
        if not ole.exists("WordDocument"):
            raise ValueError("Missing WordDocument stream in .doc file.")
        word_stream = ole.openstream("WordDocument").read()

        # Check FIB flags (offset 0x0A, bit 0x0200 selects 1Table vs 0Table)
        flags = struct.unpack_from("<H", word_stream, 0x0A)[0] if len(word_stream) >= 0x0C else 0
        table_name = "1Table" if (flags & 0x0200) else "0Table"

        text = ""
        # Try FIB ccpText + fcClx/lcbClx piece table (Word 97-2003)
        if ole.exists(table_name) and len(word_stream) >= 0x1A6:
            try:
                table_stream = ole.openstream(table_name).read()
                fc_clx, lcb_clx = struct.unpack_from("<II", word_stream, 0x1A2)
                if lcb_clx > 0 and fc_clx + lcb_clx <= len(table_stream):
                    clx = table_stream[fc_clx : fc_clx + lcb_clx]
                    pos = 0
                    while pos < len(clx):
                        clxt = clx[pos]
                        if clxt == 1:  # Prc
                            cb = struct.unpack_from("<H", clx, pos + 1)[0]
                            pos += 3 + cb
                        elif clxt == 2:  # Pcdt
                            lcb = struct.unpack_from("<I", clx, pos + 1)[0]
                            pcdt = clx[pos + 5 : pos + 5 + lcb]
                            n_pieces = (len(pcdt) - 4) // 12
                            cps = struct.unpack_from(f"<{n_pieces + 1}I", pcdt, 0)
                            pieces = []
                            pcd_offset = (n_pieces + 1) * 4
                            for i in range(n_pieces):
                                _, fc, _ = struct.unpack_from("<HIH", pcdt, pcd_offset + i * 8)
                                cp_len = cps[i + 1] - cps[i]
                                is_ansi = bool(fc & 0x40000000)
                                real_fc = (fc & 0x3FFFFFFF) // 2 if is_ansi else (fc & 0x3FFFFFFF)
                                byte_len = cp_len if is_ansi else cp_len * 2
                                chunk = word_stream[real_fc : real_fc + byte_len]
                                pieces.append(chunk.decode("cp1252" if is_ansi else "utf-16-le", errors="replace"))
                            text = "".join(pieces)
                            break
                        else:
                            break
            except Exception:
                text = ""

        if not text:
            # Fallback: extract printable ASCII/Latin runs from WordDocument stream
            text = word_stream.decode("cp1252", errors="ignore")
            text = re.sub(r"[^\x20-\x7E\r\n\t]", "\n", text)

    lines = []
    for raw_line in re.split(r"[\r\n\x0b\x07]+", text):
        cleaned = re.sub(r"[\x00-\x08\x0c\x0e-\x1f]", "", raw_line).strip()
        if cleaned:
            lines.append(cleaned)
    return lines


def convert_report_to_docx(src_path: str, dst_docx_path: str):
    """
    Pure-Python, cross-platform converter (Windows, Ubuntu, macOS) that converts
    .docx, .doc, .pdf, .txt, .xlsx, .xls, .csv into a .docx file
    so the client's mine_reports() / python-docx reader can read it.
    """
    ext = os.path.splitext(src_path)[1].lower()
    os.makedirs(os.path.dirname(dst_docx_path), exist_ok=True)

    if ext == ".docx":
        shutil.copy2(src_path, dst_docx_path)
        return

    doc = docx.Document()

    if ext == ".doc":
        for line in _extract_doc_text_pure_python(src_path):
            doc.add_paragraph(line)
        doc.save(dst_docx_path)
        return

    if ext == ".pdf":
        reader = PdfReader(src_path)
        for page in reader.pages:
            page_text = page.extract_text() or ""
            for line in page_text.splitlines():
                line = line.strip()
                if line:
                    doc.add_paragraph(line)
        doc.save(dst_docx_path)
        return

    if ext == ".txt":
        with open(src_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line:
                    doc.add_paragraph(line)
        doc.save(dst_docx_path)
        return

    if ext in (".xlsx", ".xls", ".csv"):
        df = pd.read_csv(src_path) if ext == ".csv" else pd.read_excel(src_path)
        if not df.empty:
            cols = [str(c) for c in df.columns]
            table = doc.add_table(rows=1, cols=len(cols))
            for i, c in enumerate(cols):
                table.rows[0].cells[i].text = c
            for _, row in df.iterrows():
                row_cells = table.add_row().cells
                for i, val in enumerate(row):
                    row_cells[i].text = "" if pd.isna(val) else str(val).strip()
        doc.save(dst_docx_path)
        return

    raise ValueError(f"Unsupported report format: {ext}")


def load_all_report_events(horse_names: set) -> pd.DataFrame:
    """
    Calls the client's mine_reports() on every stored .docx report file under REPORTS_DIR,
    combines results, deduplicates by (horse, date, flag, source), and preserves all report days.
    """
    frames = []
    all_days = set()

    for src in REPORT_SOURCES:
        src_dir = os.path.join(REPORTS_DIR, src)
        if not os.path.isdir(src_dir):
            continue
        files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".docx"))
        for fname in files:
            fpath = os.path.join(src_dir, fname)
            try:
                ev_part = mine_reports({src: fpath}, horse_names)
                all_days.update(ev_part.attrs.get("days", []))
                if ev_part is not None and not ev_part.empty:
                    frames.append(ev_part)
            except Exception as e:
                print(f"⚠️ [BACKEND] Failed to mine report {fpath}: {e}")

    if frames:
        ev = pd.concat(frames, ignore_index=True)
        ev = ev.drop_duplicates(subset=["horse", "date", "flag"], keep="first").reset_index(drop=True)
    else:
        ev = pd.DataFrame()

    ev.attrs["days"] = sorted(all_days)
    return ev


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
                    "chg": entry.get("confirmed_change", 0),
                    "trainer": entry.get("trainer", "Unknown"),
                    "pent": entry.get("penetrometer", ""),
                    "rail": entry.get("railing", "original position"),
                    "is_target": False,
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
    global _cached_bsm, _cached_model, _cached_ev, _cached_raw_bsm_rows, _training_info
    if _cached_bsm is None or force_reload:
        sync_master_from_ftp_if_configured()
    if (_cached_bsm is None or force_reload) and os.path.exists(DEFAULT_BSM_PATH):
        print(f"📂 [BACKEND] Loading baseline historical BSM dataset from {DEFAULT_BSM_PATH}...")
        validate_bsm_file(DEFAULT_BSM_PATH)
        raw_bsm = load_bsm(DEFAULT_BSM_PATH)
        _cached_raw_bsm_rows = None  # reset raw MIS cache so it reloads cleanly from DEFAULT_BSM_PATH
        use_confirmed = is_use_confirmed_races_enabled()
        confirmed_df = load_confirmed_races_as_df() if use_confirmed else pd.DataFrame()

        if not confirmed_df.empty:
            print(f"📈 [BACKEND] Augmenting training set with {len(confirmed_df)} confirmed handicapper runs...")
            _cached_bsm = pd.concat([raw_bsm, confirmed_df], ignore_index=True)
            _cached_bsm["horse"] = _cached_bsm["horse"].astype(str).str.strip()
        else:
            _cached_bsm = raw_bsm.copy()
            _cached_bsm["horse"] = _cached_bsm["horse"].astype(str).str.strip()

        names = set(_cached_bsm["horse"].dropna().astype(str).str.strip())
        _cached_ev = load_all_report_events(names)

        print(
            f"⚡ [BACKEND] Training hybrid RatingModel on {len(_cached_bsm)} runs "
            f"with {len(_cached_ev)} report events (USE_CONFIRMED_RACES={use_confirmed})..."
        )
        feat = build_features(_cached_bsm, _cached_ev)
        _cached_model = RatingModel(use_text=True).fit(feat[~feat["is_target"]])

        valid_dates = _cached_bsm["d"].dropna()
        min_date = str(valid_dates.min().date()) if not valid_dates.empty else "N/A"
        max_date = str(valid_dates.max().date()) if not valid_dates.empty else "N/A"

        _training_info = {
            "master_entries": len(_cached_bsm),
            "baseline_bsm_entries": len(raw_bsm),
            "confirmed_entries_incorporated": len(confirmed_df),
            "use_confirmed_races": use_confirmed,
            "report_events_loaded": len(_cached_ev),
            "model_sha256": get_model_file_sha256(),
            "min_date": min_date,
            "max_date": max_date,
            "trained_at": datetime.now().isoformat(),
        }
        print(
            f"✅ [BACKEND] Hybrid RatingModel ready! ({len(_cached_bsm)} entries, "
            f"{len(_cached_ev)} report events, {min_date} to {max_date})"
        )

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

    temp_path = os.path.join(MASTER_DIR, f"temp_upload_{datetime.now().timestamp()}.xlsx")
    try:
        with open(temp_path, "wb") as f:
            f.write(contents)

        validate_bsm_file(temp_path)
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

    archived_filename = None
    if os.path.exists(DEFAULT_BSM_PATH):
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archived_filename = f"BSM_{ts}.xlsx"
        archived_path = os.path.join(ARCHIVE_DIR, archived_filename)
        shutil.move(DEFAULT_BSM_PATH, archived_path)
        print(f"📦 [BACKEND] Archived previous master to: {archived_path}")

    shutil.move(temp_path, DEFAULT_BSM_PATH)
    print(f"💾 [BACKEND] Promoted new validated master BSM to: {DEFAULT_BSM_PATH} ({len(contents)} bytes)")

    bsm, _ = get_base_data_and_model(force_reload=True)

    return {
        "success": True,
        "message": "Master history verified, updated and rating model retrained successfully.",
        "master_entries": len(bsm) if bsm is not None else 0,
        "archived_as": archived_filename,
        "training_info": _training_info,
    }


@app.post("/api/upload-report")
async def upload_report(
    report_type: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Stores an uploaded report cumulatively under data/reports/<type>/ as .docx
    (converting PDF, Excel, CSV, text, or .doc first), mines all stored reports,
    and retrains the model.
    """
    src = REPORT_TYPE_MAP.get(report_type.strip().upper(), report_type.strip().lower())
    if src not in REPORT_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported report_type: {report_type}")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded report file is empty.")

    temp_dir = tempfile.mkdtemp()
    try:
        orig_name = os.path.basename(file.filename or "report.docx")
        raw_path = os.path.join(temp_dir, orig_name)
        with open(raw_path, "wb") as f:
            f.write(contents)

        stem = os.path.splitext(orig_name)[0]
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_dir = os.path.join(REPORTS_DIR, src)
        os.makedirs(target_dir, exist_ok=True)
        dst_docx_path = os.path.join(target_dir, f"{ts}_{stem}.docx")

        convert_report_to_docx(raw_path, dst_docx_path)

        get_base_data_and_model(force_reload=True)

        return {
            "success": True,
            "report_type": src,
            "stored_file": os.path.basename(dst_docx_path),
            "report_events_loaded": _training_info.get("report_events_loaded", 0),
            "training_info": _training_info,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process report: {e}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


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
        except Exception:
            all_confirmed = []

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

    if is_use_confirmed_races_enabled():
        get_base_data_and_model(force_reload=True)

    return {
        "success": True,
        "message": f"Confirmed decisions for {venue} Race #{r_no} saved.",
        "total_confirmed_races": len(all_confirmed),
        "use_confirmed_races": is_use_confirmed_races_enabled(),
    }


def _build_raw_bsm_mis_rows() -> List[Dict[str, Any]]:
    """Reads all 22 columns of DEFAULT_BSM_PATH and caches formatted MIS rows in memory."""
    global _cached_raw_bsm_rows
    if _cached_raw_bsm_rows is not None:
        return _cached_raw_bsm_rows
    if not os.path.exists(DEFAULT_BSM_PATH):
        return []

    df = pd.read_excel(DEFAULT_BSM_PATH)
    if df.empty:
        _cached_raw_bsm_rows = []
        return _cached_raw_bsm_rows

    def s(val, default="—"):
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return default
        txt = str(val).strip()
        return txt if txt else default

    rows = []
    for idx, row in df.iterrows():
        raw_date = row.get("Race Date")
        dt = pd.to_datetime(raw_date, format="%d/%m/%Y", errors="coerce")
        if pd.isna(dt):
            dt = pd.to_datetime(raw_date, errors="coerce")
        iso_date = dt.strftime("%Y-%m-%d") if pd.notna(dt) else "—"
        fmt_date = dt.strftime("%d %b %Y") if pd.notna(dt) else s(raw_date)

        cat = s(row.get("Race Category"))
        is_terms = bool(re.search(r"TERMS|MAIDEN|CLASSIC|SWEEPSTAKES|DERBY|OAKS|GUINEAS|CUP|TROPHY|MILLION|PLATE|STAKES|2YO|3YO|4YO|3Y&O|4Y&O", cat, re.I))
        r_type = "TERMS" if is_terms else "HANDICAP"

        cur_rat = row.get("Current Rating")
        cur_rat_val = None if pd.isna(cur_rat) else int(float(cur_rat))
        chg_raw = row.get("Change Rating")
        chg_val = None if (pd.isna(chg_raw) or float(chg_raw) < -100) else int(float(chg_raw))
        final_rat_val = (cur_rat_val + chg_val) if (cur_rat_val is not None and chg_val is not None) else cur_rat_val

        dist_raw = row.get("Distance")
        hw_raw = row.get("Horse Weight")
        wd_raw = row.get("Weight Declare")
        wc_raw = row.get("Weight Carried")
        sg_raw = row.get("Start Gate")
        pl_raw = row.get("Placing")
        card_raw = row.get("Card No")
        pent_raw = row.get("Penetrometer  Reading", row.get("Penetrometer Reading"))

        rows.append({
            "id": f"bsm_{idx}",
            "isMaster": True,
            "venue": s(row.get("Venue")),
            "raceDate": iso_date,
            "raceDateFormatted": fmt_date,
            "raceSeason": s(row.get("Race Season")),
            "raceType": r_type,
            "raceCategory": cat,
            "raceNo": int(float(row.get("Race No"))) if pd.notna(row.get("Race No")) else "—",
            "cardNo": int(float(card_raw)) if pd.notna(card_raw) else "—",
            "distance": f"{int(float(dist_raw))} m" if pd.notna(dist_raw) else "—",
            "currentRating": cur_rat_val if cur_rat_val is not None else "—",
            "horseName": s(row.get("Horse Name")),
            "horseWeight": f"{float(hw_raw)} kg" if pd.notna(hw_raw) else "—",
            "shoes": s(row.get("Shoes")),
            "startGate": int(float(sg_raw)) if pd.notna(sg_raw) else "—",
            "weightDeclare": f"{float(wd_raw)} kg" if pd.notna(wd_raw) else "—",
            "jockey": s(row.get("Jockey")),
            "weightCarried": f"{float(wc_raw)} kg" if pd.notna(wc_raw) else "—",
            "placing": int(float(pl_raw)) if pd.notna(pl_raw) else "—",
            "timing": s(row.get("Timing")),
            "verdict": s(row.get("Verdict")),
            "trainer": s(row.get("Trainer")),
            "penetrometer": float(pent_raw) if pd.notna(pent_raw) else "—",
            "railing": s(row.get("Railing Position")),
            "starterReport": "—",
            "veterinaryReport": "—",
            "incidentReport": "—",
            "status": "RATED",
            "override": "No",
            "finalChange": ("+" + str(chg_val) if chg_val > 0 else str(chg_val)) if chg_val is not None else "—",
            "reasonExplanation": "Master BSM Historical Record",
            "finalRating": final_rat_val if final_rat_val is not None else "—",
            "recommendedRating": final_rat_val if final_rat_val is not None else "—",
            "overridden": False,
        })

    _cached_raw_bsm_rows = rows
    return _cached_raw_bsm_rows


@app.get("/api/master-records")
def get_master_records():
    """Returns all BSM.xlsx master records mapped to the MIS columns."""
    rows = _build_raw_bsm_mis_rows()
    return {
        "success": True,
        "totalCount": len(rows),
        "rows": rows,
    }


@app.get("/api/model-info")
def get_model_info():
    """Returns metadata about the active training set, entries count, report events, and model hash."""
    bsm, _ = get_base_data_and_model()
    is_loaded = bsm is not None and not bsm.empty
    return {
        "success": True,
        "master_data_loaded": is_loaded,
        "master_entries": len(bsm) if is_loaded else 0,
        "model_sha256": _training_info.get("model_sha256") or get_model_file_sha256(),
        "report_events_loaded": _training_info.get("report_events_loaded", 0),
        "use_confirmed_races": _training_info.get("use_confirmed_races", is_use_confirmed_races_enabled()),
        "training_info": _training_info,
    }


class MeetingEntrantPayload(BaseModel):
    entry_id: Optional[int] = None
    race_id: Optional[int] = None
    racedate: str
    season: Optional[str] = "2026-27"
    category: str
    raceno: int
    distance: int
    currat: Optional[float] = None
    horse_name: str
    horse_weight: Optional[Any] = None
    shoes: Optional[str] = "A"
    gate: Optional[int] = None
    jockey: Optional[str] = "Unknown"
    placing: Optional[int] = None
    timing: Optional[str] = None
    verdict: Optional[Any] = None
    trainer: Optional[str] = "Unknown"
    penetrometer: Optional[Any] = None
    railing: Optional[Any] = None


class MeetingPayload(BaseModel):
    entries: List[MeetingEntrantPayload]


class ReportEvidenceRequest(BaseModel):
    horses: List[str] = []


@app.post("/api/report-evidence")
def get_report_evidence(payload: ReportEvidenceRequest):
    """
    Returns mined report evidence rows matching the client's 'Report Evidence' sheet:
    ['Horse', 'Report date', 'Source', 'Flag', 'Remark (truncated)'], sorted by horse, date.
    """
    bsm, _ = get_base_data_and_model()
    bsm_names = set(bsm["horse"].dropna().astype(str).str.strip()) if bsm is not None else set()
    req_names = {str(h).strip() for h in payload.horses if str(h).strip()}
    ev = load_all_report_events(bsm_names | req_names)

    rows = []
    if ev is not None and not ev.empty:
        filtered = ev[ev["horse"].isin(req_names)] if req_names else ev
        for _, e in filtered.sort_values(["horse", "date"]).iterrows():
            rows.append({
                "horse": e["horse"],
                "report_date": str(e["date"].date()),
                "source": e["source"],
                "flag": e["flag"],
                "remark": e["text"],
            })

    return {"success": True, "evidence": rows}


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
    Returns chronological hold-out validation metrics for the BTC hybrid model
    using the exact same master + report events data as training.
    """
    bsm, _ = get_base_data_and_model()
    if bsm is None:
        raise HTTPException(status_code=500, detail="Master history dataset is not loaded.")

    try:
        names = set(bsm["horse"].dropna().astype(str).str.strip())
        ev = _cached_ev if _cached_ev is not None else load_all_report_events(names)
        feat = build_features(bsm, ev)
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


@app.post("/api/predict-meeting")
def predict_meeting(payload: MeetingPayload):
    """
    Rates an entire meeting (all races and dates together in one request)
    by building the DataFrame identically to client's load_bwm() and running
    build_features, model.predict, text_effect, and justify identically to client's main().
    """
    bsm, model = get_base_data_and_model()
    if bsm is None or model is None:
        raise HTTPException(
            status_code=500,
            detail="Historical BSM master dataset is not loaded.",
        )

    try:
        bwm = pd.DataFrame({
            "d": pd.to_datetime([e.racedate for e in payload.entries], errors="coerce"),
            "season": [e.season for e in payload.entries],
            "cat": [e.category for e in payload.entries],
            "raceno": [e.raceno for e in payload.entries],
            "dist": [e.distance for e in payload.entries],
            "rating": [e.currat for e in payload.entries],
            "horse": [str(e.horse_name).strip() for e in payload.entries],
            "hw": [e.horse_weight for e in payload.entries],
            "shoe": [e.shoes for e in payload.entries],
            "gate": [e.gate for e in payload.entries],
            "jockey": [e.jockey for e in payload.entries],
            "place": [e.placing for e in payload.entries],
            "timing": [e.timing for e in payload.entries],
            "verdict": [e.verdict for e in payload.entries],
            "chg": np.nan,
            "trainer": [e.trainer for e in payload.entries],
            "pent": [e.penetrometer for e in payload.entries],
            "rail": [e.railing for e in payload.entries],
            "is_target": True,
        })
        bwm["src_row"] = np.arange(len(bwm))

        names = set(bsm["horse"].dropna().astype(str).str.strip()) | set(bwm["horse"].str.strip())
        ev = load_all_report_events(names)

        all_rows = pd.concat([bsm, bwm], ignore_index=True)
        all_rows["horse"] = all_rows["horse"].str.strip()
        feat = build_features(all_rows, ev)

        model = RatingModel(use_text=True).fit(feat[~feat["is_target"]])
        tgt = feat[feat["is_target"]].copy()
        tgt = model.predict(tgt)
        tgt["text_eff"] = model.text_effect(tgt)
        tgt["rule_base"] = model.rule.base(tgt)
        tgt = tgt.sort_values("src_row")

        ev_by_h = {h: g for h, g in ev.groupby("horse")} if len(ev) else {}

        results = []
        for _, r in tgt.iterrows():
            src_idx = int(r["src_row"])
            orig_entry = payload.entries[src_idx]
            eh = ev_by_h.get(r["horse"])
            if eh is not None:
                eh = eh[(eh["date"] < r["d"]) & (eh["date"] >= r["d"] - pd.Timedelta(days=365))]

            j = justify(r, eh, r["text_eff"], r["rule_base"])
            rec_chg = 0 if not r["runner"] else int(r["rec"])
            cur_rat = None if pd.isna(r["rating"]) else int(r["rating"])
            new_rat = cur_rat if not r["runner"] else (None if cur_rat is None else int(max(0, cur_rat + rec_chg)))

            results.append({
                "entry_id": orig_entry.entry_id,
                "race_id": orig_entry.race_id,
                "horse_name": r["horse"],
                "race_date": str(r["d"].date()) if pd.notna(r["d"]) else None,
                "raceno": int(r["raceno"]) if pd.notna(r["raceno"]) else None,
                "placing": int(r["place"]) if pd.notna(r["place"]) else None,
                "current_rating": cur_rat,
                "recommended_change": rec_chg,
                "recommended_rating": new_rat,
                "justification": j,
                "status": "RATED" if r["runner"] else "UNCHANGED",
            })

        return {
            "success": True,
            "total_horses": len(results),
            "report_events_loaded": len(ev),
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

        report_paths = {"stewards": None, "vet": None, "starter": None, "incident": None}

        if stipe_file and stipe_file.filename:
            raw_p = os.path.join(temp_dir, stipe_file.filename)
            with open(raw_p, "wb") as f:
                f.write(await stipe_file.read())
            docx_p = os.path.join(temp_dir, "stewards.docx")
            convert_report_to_docx(raw_p, docx_p)
            report_paths["stewards"] = docx_p

        if vet_file and vet_file.filename:
            raw_p = os.path.join(temp_dir, vet_file.filename)
            with open(raw_p, "wb") as f:
                f.write(await vet_file.read())
            docx_p = os.path.join(temp_dir, "vet.docx")
            convert_report_to_docx(raw_p, docx_p)
            report_paths["vet"] = docx_p

        if starter_file and starter_file.filename:
            raw_p = os.path.join(temp_dir, starter_file.filename)
            with open(raw_p, "wb") as f:
                f.write(await starter_file.read())
            docx_p = os.path.join(temp_dir, "starter.docx")
            convert_report_to_docx(raw_p, docx_p)
            report_paths["starter"] = docx_p

        if incidence_file and incidence_file.filename:
            raw_p = os.path.join(temp_dir, incidence_file.filename)
            with open(raw_p, "wb") as f:
                f.write(await incidence_file.read())
            docx_p = os.path.join(temp_dir, "incident.docx")
            convert_report_to_docx(raw_p, docx_p)
            report_paths["incident"] = docx_p

        validate_bwm_file(bwm_path)
        bwm = load_bwm(bwm_path)

        if history_file is not None and history_file.filename:
            bsm_path = os.path.join(temp_dir, history_file.filename)
            with open(bsm_path, "wb") as f:
                f.write(await history_file.read())
            validate_bsm_file(bsm_path)
            bsm = load_bsm(bsm_path)
            names = set(bsm["horse"].dropna().str.strip()) | set(bwm["horse"].str.strip())
            ev = mine_reports(report_paths, names)
            all_rows = pd.concat([bsm, bwm], ignore_index=True)
            all_rows["horse"] = all_rows["horse"].str.strip()
            feat = build_features(all_rows, ev)
            model = RatingModel(use_text=True).fit(feat[~feat["is_target"]])
        elif os.path.exists(DEFAULT_BSM_PATH):
            bsm, model = get_base_data_and_model()
            names = set(bsm["horse"].dropna().str.strip()) | set(bwm["horse"].str.strip())
            if any(report_paths.values()):
                ev = mine_reports(report_paths, names)
            else:
                ev = load_all_report_events(names)
            all_rows = pd.concat([bsm, bwm], ignore_index=True)
            all_rows["horse"] = all_rows["horse"].str.strip()
            feat = build_features(all_rows, ev)
        else:
            raise HTTPException(
                status_code=400,
                detail="Master history file (BSM.xlsx) not provided and default not found.",
            )

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
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
