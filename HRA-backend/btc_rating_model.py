#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BTC Rating-Change Recommender  (hybrid rule + statistical + text-mining model)
==============================================================================
Reads
  * BSM.xlsx   - historical race results with the 'Change Rating' actually applied
  * BWM.xlsx   - the meeting to be assessed (no 'Change Rating' yet)
  * Stipe.docx / Vet.docx / Starter.docx / Incidence.docx - Stipendiary Stewards,
    Veterinary, Starter and Racing-Incident reports
and writes a copy of BWM.xlsx with three new columns
    Recommended Rating Change | Proposed New Rating | Justification
plus an 'Evidence' sheet that lists the report remarks that were found for each horse.

Usage
-----
    pip install pandas numpy scikit-learn openpyxl python-docx
    python btc_rating_model.py --bsm BSM.xlsx --bwm BWM.xlsx \
        --stipe Stipe.docx --vet Vet.docx --starter Starter.docx --incidence Incidence.docx \
        --out BWM_with_recommended_ratings.xlsx [--validate]

Layers
------
  1. RULE layer      empirical BTC rating-revision table  (class group x finishing band)
  2. LEARNED layer   gradient-boosting correction of the rule table using numeric variables
                     (margin, time, field, form, going, rail, shoes, weight, jockey/trainer ...)
                     and text-derived history variables from the four reports
  3. GUARD layer     BTC conventions (limits per finishing band, rating floor, class band)
  4. EXPLAIN layer   plain-English justification built from the numbers above
"""
import re, sys, argparse, warnings
from fractions import Fraction
from datetime import datetime
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ----------------------------------------------------------------------------------------------
# 0.  CONSTANTS
# ----------------------------------------------------------------------------------------------
HANDICAP_CATS = ["00-25", "20-45", "40-65", "60-85", "70+", "80+"]
CAT_LEVEL = {"00-25": 12, "20-45": 32, "40-65": 52, "60-85": 72, "70+": 80, "80+": 90,
             "2YO": 20, "3YO": 30, "4YO": 40, "3Y&O": 60, "4Y&O": 60}
CAT_BAND = {"00-25": (0, 25), "20-45": (20, 45), "40-65": (40, 65), "60-85": (60, 85)}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# ----------------------------------------------------------------------------------------------
# 1.  LOADING AND CLEANING THE EXCEL FILES
# ----------------------------------------------------------------------------------------------
def parse_margin(v):
    """'Short Head', '1 1/4', '3/4', 2.5  ->  lengths (float)"""
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return np.nan
    s = str(v).strip().lower()
    named = {"nose": .05, "short head": .1, "sh": .1, "head": .2, "short neck": .25,
             "neck": .3, "long neck": .35, "distance": 30, "dist": 30}
    if s in named:
        return named[s]
    try:
        return float(sum(float(Fraction(p)) for p in s.split()))
    except Exception:
        return np.nan


def first_number(x):
    try:
        return float(re.findall(r"[\d.]+", str(x))[0])
    except Exception:
        return np.nan


def rail_width(txt):
    """'Railing fixed at an average width of 2.5 Meters ...' -> 2.5 ; 'original position' -> 0"""
    if not isinstance(txt, str):
        return np.nan
    m = re.search(r"width of\s*([\d.]+)", txt, re.I)
    return float(m.group(1)) if m else 0.0


def load_bsm(path):
    cols = ["venue", "date", "season", "cat", "raceno", "card", "dist", "rating", "horse", "hw", "shoe",
            "gate", "wdecl", "jockey", "wcar", "place", "timing", "verdict", "chg", "trainer", "pent", "rail"]
    try:
        b = pd.read_excel(path)
    except Exception as e:
        raise ValueError(f"Corrupted Excel file: unable to read workbook from {path} ({e})")

    if b.empty:
        raise ValueError(f"Corrupted or empty file: no data rows found in {path}")

    # Check for corrupted columns structure
    if b.shape[1] >= len(cols):
        b = b.iloc[:, :len(cols)]
        b.columns = cols
    elif b.shape[1] < len(cols) - 4:
        raise ValueError(f"Corrupted file: expected at least {len(cols)-4} columns, but file only has {b.shape[1]}")
    else:
        for i in range(b.shape[1], len(cols)):
            b[cols[i]] = np.nan
        b.columns = cols

    # Clean corrupted dates and values
    b["d"] = pd.to_datetime(b["date"], errors="coerce")
    b = b.dropna(subset=["d"]).copy()
    if b.empty:
        raise ValueError("Corrupted file: no valid race dates found in 'date' column.")

    b["is_target"] = False
    b["chg"] = pd.to_numeric(b["chg"], errors="coerce")
    b.loc[b["chg"] < -100, "chg"] = np.nan          # -999 sentinel
    b["rating"] = pd.to_numeric(b["rating"], errors="coerce")
    b["dist"] = pd.to_numeric(b["dist"], errors="coerce").fillna(1200)
    b["horse"] = b["horse"].astype(str).str.strip()
    return b[["d", "season", "cat", "raceno", "dist", "rating", "horse", "hw", "shoe", "gate", "jockey",
              "place", "timing", "verdict", "chg", "trainer", "pent", "rail", "is_target"]]


def load_bwm(path):
    try:
        w = pd.read_excel(path)
    except Exception as e:
        raise ValueError(f"Corrupted Excel file: unable to read workbook from {path} ({e})")

    if w.empty:
        raise ValueError(f"Corrupted or empty file: no rows found in {path}")

    # Normalize column names for robust matching
    norm_cols = {str(c).strip().lower(): c for c in w.columns}

    def get_col(candidates, default_val=None):
        for cand in candidates:
            if cand.lower() in norm_cols:
                return w[norm_cols[cand.lower()]]
        if default_val is not None:
            return pd.Series([default_val] * len(w), index=w.index)
        return pd.Series([np.nan] * len(w), index=w.index)

    horse_col = get_col(["HorseName", "horse", "name"])
    if horse_col.isna().all():
        raise ValueError("Corrupted file: missing or corrupted 'HorseName' column.")

    out = pd.DataFrame({
        "d": pd.to_datetime(get_col(["racedate", "date"]), errors="coerce"),
        "season": get_col(["raceseason", "season"], "2026-27"),
        "cat": get_col(["racecat", "category"], "00-25"),
        "raceno": pd.to_numeric(get_col(["raceno", "race_no"]), errors="coerce").fillna(1).astype(int),
        "dist": pd.to_numeric(get_col(["distance", "dist"]), errors="coerce").fillna(1200),
        "rating": pd.to_numeric(get_col(["currat", "rating"]), errors="coerce"),
        "horse": horse_col.astype(str).str.strip(),
        "hw": pd.to_numeric(get_col(["horswgt", "hw"]), errors="coerce"),
        "shoe": get_col(["shoe", "shoes"], "A"),
        "gate": pd.to_numeric(get_col(["startstall", "gate"]), errors="coerce"),
        "jockey": get_col(["jockey"], "Unknown"),
        "place": pd.to_numeric(get_col(["placing", "place"]), errors="coerce"),
        "timing": get_col(["Timing", "timing"]),
        "verdict": get_col(["Verdict", "verdict"]),
        "chg": np.nan,
        "trainer": get_col(["trainer"], "Unknown"),
        "pent": get_col(["pent", "penetrometer"], ""),
        "rail": get_col(["Railing Position", "rail"], "original position"),
        "is_target": True
    })
    out["src_row"] = np.arange(len(out))
    return out


# ----------------------------------------------------------------------------------------------
# 2.  MINING THE FOUR WORD REPORTS
# ----------------------------------------------------------------------------------------------
import docx   # python-docx
from docx.table import Table

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
DAY_RE = re.compile(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|"
                    r"september|october|november|december)[,\s]+(\d{4})", re.I)
RACE_RE = re.compile(r"^\s*\d+\s*(?:st|nd|rd|th)\s*Race\s*:\s*(\d+)\s*\.", re.I)

# text flag -> regex.  Order is irrelevant; one paragraph can raise several flags.
FLAGS = [
    ("vet_lame", r"\blame\b|unsound|lameness"),
    ("vet_bleed", r"bleeding|EIPH|epistaxis|nostril"),
    ("vet_injury", r"injur|abrasion|abscess|clip|swelling|inflamed|capped|bruis|cut\b|sore"),
    ("vet_withdrawn", r"withdr[ae]w[n]?\s|withdrawn on veterinary|permitted to be withdrawn"),
    ("vet_clear", r"no abnormality|trotting sound|\bNAD\b"),
    ("vet_resp", r"roaring|wind\b|tongue"),
    ("gate_slow", r"slowly away|missed the break|lost (?:a )?(?:few|many) lengths"),
    ("gate_fly", r"fly jump"),
    ("gate_bad", r"planted|refused to|fractious|knuckled|swerved|jumped (?:out )?awkwardly|bolted|rear"),
    ("gate_cert_revoked", r"certificate is revoked|not to accept with it again until its behaviour"),
    ("behav_hang", r"hanging|hung\b|bearing (?:in|out)|laid (?:in|out)"),
    ("behav_green", r"running green|ran green|green throughout|inexperience"),
    ("behav_detached", r"ran detached|took no (?:practical )?part|did not take any practical part|"
                       r"not raise a fluent|not galloping fluently|not striding out|stopped galloping"),
    ("behav_fierce", r"raced fiercely|pulled hard|over[- ]raced"),
    ("hardluck", r"could not get a clear (?:run|view)|closely packed|had to (?:check|steady)|"
                 r"inconvenienced by|taken out|obstructed|in check"),
    ("trainer_warn", r"corrective measures|remedial measures|ensure better performance|take appropriate"),
    ("enquiry_form", r"enquiry[^.]*relative performance|improvement in (?:form|performance)"),
    ("indifferent_ride", r"indifferent race"),
]
FLAGS = [(n, re.compile(r, re.I)) for n, r in FLAGS]
JOCKEY_DISC = re.compile(r"Jockey [A-Z][\w\.\s]*?, the (?:declared )?rider of ([A-Z][A-Z\s'\.&\-]+?) "
                         r"(?:was|were) (fined|reprimanded|severely reprimanded|suspended|warned)")
FLAG_GROUP = {"gate": ["gate_slow", "gate_fly", "gate_bad", "gate_cert_revoked"],
              "vet": ["vet_lame", "vet_bleed", "vet_injury", "vet_withdrawn", "vet_resp"],
              "behav": ["behav_hang", "behav_detached", "behav_green", "behav_fierce", "indifferent_ride"],
              "hardluck": ["hardluck"], "warn": ["trainer_warn"], "jdisc": ["jockey_discipline"],
              "clear": ["vet_clear"], "enq": ["enquiry_form"]}
FLAG_GROUP_OF = {f: g for g, fl in FLAG_GROUP.items() for f in fl}


def iter_blocks(path):
    d = docx.Document(path)
    for ch in d.element.body.iterchildren():
        tag = ch.tag.split("}")[1]
        if tag == "p":
            t = ch.xpath("string(.)").strip()
            if t:
                yield "p", t
        elif tag == "tbl":                                     # the veterinary report is a table per race
            for row in Table(ch, d).rows:
                cells = []
                for c in row.cells:                            # merged cells repeat -> keep first occurrence only
                    t = c.text.strip()
                    if t and t not in cells:
                        cells.append(t)
                if len(cells) >= 2:
                    yield "row", cells


def read_report(path, source):
    out, date, race = [], None, None
    for kind, val in iter_blocks(path):
        if kind == "p":
            if re.search(r"\bday\b", val, re.I) and DAY_RE.search(val):
                m = DAY_RE.search(val)
                date = datetime(int(m.group(3)), MONTHS[m.group(2)[:3].lower()], int(m.group(1))).date()
                race = None
                continue
            m = RACE_RE.match(val)
            if m:
                race = int(m.group(1)); continue
            if date and race:
                out.append(dict(source=source, date=date, raceno=race, text=val, hint=None))
        elif date and race:
            out.append(dict(source=source, date=date, raceno=race, text=val[1], hint=val[0].upper().strip()))
    return out


def mine_reports(paths, horse_names):
    """paths = {'stewards':..., 'vet':..., 'starter':..., 'incident':...}  ->  DataFrame of events"""
    recs = []
    for src, p in paths.items():
        if p:
            recs += read_report(p, src)
    names = sorted({n.strip() for n in horse_names if isinstance(n, str) and len(n.strip()) >= 3},
                   key=len, reverse=True)
    rx = re.compile(r"(?<![A-Z'])(" + "|".join(re.escape(n) for n in names) + r")(?![A-Z])")
    nameset, seen, rows = set(names), set(), []
    for r in recs:
        txt = r["text"]
        if r["hint"] and r["hint"] in nameset:                   # vet-table row: horse is in column 1
            found = [r["hint"]]
        else:
            found = list(dict.fromkeys(m.group(1) for m in rx.finditer(txt)))
        for i, nm in enumerate(found):
            subject = i == 0                                      # first-named horse is the subject
            for fl, rg in FLAGS:
                if not rg.search(txt):
                    continue
                if not subject and fl != "hardluck":
                    continue
                if not subject and not re.search(r"inconvenienc|interfer|bump|tighten|taken out|check", txt, re.I):
                    continue
                key = (nm, r["date"], fl)
                if key not in seen:
                    seen.add(key)
                    rows.append(dict(horse=nm, date=pd.Timestamp(r["date"]), raceno=r["raceno"], flag=fl,
                                     source=r["source"], text=txt[:400]))
            m = JOCKEY_DISC.search(txt)
            if m and subject and nm == m.group(1).strip() and (nm, r["date"], "jockey_discipline") not in seen:
                seen.add((nm, r["date"], "jockey_discipline"))
                rows.append(dict(horse=nm, date=pd.Timestamp(r["date"]), raceno=r["raceno"],
                                 flag="jockey_discipline", source=r["source"], text=txt[:400]))
    ev = pd.DataFrame(rows)
    ev.attrs["days"] = sorted({pd.Timestamp(r["date"]) for r in recs})      # race days that have a report
    return ev


def text_history_features(df, ev, half_life=120, window=365):
    """For each row: exponentially decayed count of report events in the 365 days BEFORE the race."""
    groups = list(FLAG_GROUP.keys())
    for g in groups:
        df["txt_" + g] = 0.0
    df["txt_vet_days"] = 365.0
    if ev is None or ev.empty:
        return df
    ev = ev.copy()
    ev["grp"] = ev["flag"].map(FLAG_GROUP_OF)
    key = df[["horse", "d"]].reset_index().rename(columns={"index": "ridx"})
    m = key.merge(ev[["horse", "date", "grp", "flag"]], on="horse", how="inner")
    m["age"] = (m["d"] - m["date"]).dt.days
    m = m[(m["age"] > 0) & (m["age"] <= window)]
    m["w"] = 0.5 ** (m["age"] / half_life)
    agg = m.pivot_table(index="ridx", columns="grp", values="w", aggfunc="sum", fill_value=0.0)
    for g in agg.columns:
        df.loc[agg.index, "txt_" + g] = agg[g].values
    vv = m[m["grp"] == "vet"].groupby("ridx")["age"].min()
    df.loc[vv.index, "txt_vet_days"] = vv.values
    # report coverage: before the first report date the history is "unknown", not "clean"
    start = ev["date"].min()
    df["txt_known"] = (df["d"] > start).astype(int)
    for g in groups + ["vet_days"]:
        c = "txt_" + g
        df.loc[df["txt_known"] == 0, c] = np.nan
    return df


def same_race_features(df, ev):
    """Flags from the reports of the SAME race day (only known when that day's reports were supplied)."""
    for g in ["gate", "vet", "behav", "hardluck", "jdisc", "warn"]:
        df["same_" + g] = np.nan
    if ev is None or ev.empty:
        return df
    days = set(ev.attrs.get("days", []))
    known = df["d"].isin(days)
    e = ev.assign(grp=ev["flag"].map(FLAG_GROUP_OF))
    for g in ["gate", "vet", "behav", "hardluck", "jdisc", "warn"]:
        s = e[e["grp"] == g][["horse", "date"]].drop_duplicates().assign(_f=1.0).rename(columns={"date": "d"})
        df = df.merge(s, on=["horse", "d"], how="left")
        df["same_" + g] = np.where(known, df["_f"].fillna(0.0), np.nan)
        df = df.drop(columns="_f")
    return df


# ----------------------------------------------------------------------------------------------
# 3.  FEATURE ENGINEERING (numeric variables)
# ----------------------------------------------------------------------------------------------
def build_features(df, ev):
    df = df.copy()
    df["hw"] = df["hw"].map(first_number)
    df["pent"] = df["pent"].map(first_number)
    df["rail_w"] = df["rail"].map(rail_width)
    df["m"] = df["verdict"].map(parse_margin)
    df["runner"] = df["place"].notna()
    df["rid"] = df["d"].astype(str) + "_" + df["raceno"].astype(str)
    df["rating"] = pd.to_numeric(df["rating"], errors="coerce")
    df["rat"] = df["rating"].where(df["rating"] > 0)
    df["cat_level"] = df["cat"].map(CAT_LEVEL)
    df["handicap"] = df["cat"].isin(HANDICAP_CATS).astype(int)
    df["cgroup"] = np.where(df["cat"].isin(["3YO", "2YO", "4YO"]), "AGE",
                    np.where(df["cat"].isin(["3Y&O", "4Y&O"]), "AGEOPEN",
                    np.where(df["rat"] >= 60, "HIGH", "LOW")))

    # ---- race-level: field size, distance behind winner, winning margin
    df = df.sort_values(["rid", "place"])
    df["nrun"] = df.groupby("rid")["runner"].transform("sum")
    df["mm"] = df["m"].where(df["place"] > 1, 0).fillna(0)
    df["btn"] = df.groupby("rid")["mm"].cumsum().where(df["runner"])      # lengths behind the winner
    second_m = df[df["place"] == 2].drop_duplicates("rid").set_index("rid")["m"]
    df["win_margin"] = np.where(df["place"] == 1, df["rid"].map(second_m), np.nan)
    df["place_pct"] = df["place"] / df["nrun"]
    df["rat_rel"] = df["rat"] - df.groupby("rid")["rat"].transform("mean")
    df["rat_rank"] = df.groupby("rid")["rat"].rank(ascending=False)
    df["topweight"] = (df["rat"] == df.groupby("rid")["rat"].transform("max")).astype(int)
    df["gate_rel"] = df["gate"] / df["nrun"]
    # timing -> seconds, distance behind winner in time, speed index vs par for the distance
    def to_sec(s):
        try:
            p = str(s).split(":"); return float(p[0]) * 60 + float(p[1]) if len(p) == 2 else np.nan
        except Exception:
            return np.nan
    df["dsec"] = df["timing"].map(to_sec)
    df["tbtn"] = df["dsec"] - df.groupby("rid")["dsec"].transform("min")
    win_t = df[df["place"] == 1].groupby("dist")["dsec"].median()
    df["speed_idx"] = df["dsec"] - df["dist"].map(win_t)
    df["shoe_aid"] = df["shoe"].astype(str).str.count("HA|BA|RPA|RBA")
    df["shoe_x"] = df["shoe"].astype(str).str.contains("X").astype(int)

    # ---- horse history (strictly earlier runs)
    df = df.sort_values(["horse", "d", "raceno"]).reset_index(drop=True)
    g = df.groupby("horse")
    df["days_since"] = (df["d"] - g["d"].shift(1)).dt.days
    df["prev_place"] = g["place"].shift(1)
    df["prev_btn"] = g["btn"].shift(1)
    df["prev_rating"] = g["rating"].shift(1)
    df["run_no"] = g.cumcount() + 1
    df["wins_prior"] = g["place"].transform(lambda s: (s == 1).cumsum().shift(1).fillna(0))
    df["top3_last3"] = g["place"].transform(lambda s: (s <= 3).astype(float).shift(1).rolling(3, min_periods=1).mean())
    df["pct_last3"] = g["place_pct"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["btn_last3"] = g["btn"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    df["hw_delta"] = df["hw"] - g["hw"].shift(1)
    df["dist_delta"] = df["dist"] - g["dist"].shift(1)
    df["shoe_change"] = (df["shoe"] != g["shoe"].shift(1)).astype(int)
    df["next_rating"] = g["rating"].shift(-1)

    # ---- target: recorded change; blank = "no change" when the horse has a later rated run
    df["y"] = np.where(df["chg"].notna(), df["chg"],
                       np.where(df["next_rating"] > 0, 0.0, np.nan))
    df.loc[df["chg"].isna() & (df["place"] >= 4) & df["runner"], "y"] = 0.0   # blank for unplaced = no change
    df["prev_y"] = df.groupby("horse")["y"].shift(1)

    # ---- jockey & trainer form (shrunk top-3 strike rate, earlier days only)
    for who in ["jockey", "trainer"]:
        t = df[df["runner"]].groupby([who, "d"])["place"].agg(n="size", k=lambda s: (s <= 3).sum()).reset_index()
        t = t.sort_values([who, "d"])
        t["cn"] = t.groupby(who)["n"].cumsum() - t["n"]
        t["ck"] = t.groupby(who)["k"].cumsum() - t["k"]
        t[who + "_form"] = (t["ck"] + 20 * 0.30) / (t["cn"] + 20)
        df = df.merge(t[[who, "d", who + "_form"]], on=[who, "d"], how="left")

    df = text_history_features(df, ev)
    df = same_race_features(df, ev)
    return df


NUM_FEATURES = ["place", "place_pct", "btn", "win_margin", "m", "tbtn", "speed_idx", "nrun", "rating", "rat_rel",
                "rat_rank", "topweight", "cat_level", "handicap", "dist", "pent", "rail_w", "gate", "gate_rel",
                "hw", "hw_delta", "dist_delta", "shoe_aid", "shoe_x", "shoe_change", "days_since", "prev_place",
                "prev_btn", "prev_rating", "run_no", "wins_prior", "top3_last3", "pct_last3", "btn_last3", "prev_y",
                "jockey_form", "trainer_form"]
SAME_RACE = ["same_gate", "same_vet", "same_behav", "same_hardluck", "same_jdisc", "same_warn"]
TEXT_FEATURES = SAME_RACE + ["txt_gate", "txt_vet", "txt_behav", "txt_hardluck", "txt_warn", "txt_jdisc", "txt_clear",
                 "txt_enq", "txt_vet_days"]

# ----------------------------------------------------------------------------------------------
# 4.  RULE LAYER  (empirical BTC revision table)
# ----------------------------------------------------------------------------------------------
def pband(p):
    return np.where(p == 1, "1st", np.where(p == 2, "2nd", np.where(p == 3, "3rd", "4th+")))


class RuleTable:
    """Median/mean rating change by class group x finishing band, learned from the history."""
    def fit(self, d):
        d = d[d["runner"] & d["y"].notna() & (d["rat"] > 0)].copy()
        d["band"] = pband(d["place"])
        self.tab = {}
        for (cg, bd), s in d.groupby(["cgroup", "band"]):
            self.tab[(cg, bd)] = float(s["y"].mean() if bd != "4th+" else s["y"].median())
        self.fallback = {bd: float(s["y"].mean() if bd != "4th+" else s["y"].median()) for bd, s in d.groupby("band")}
        # guard rails: 1st-99th percentile of observed change per finishing band
        self.limits = {bd: (float(s["y"].quantile(.01)), float(s["y"].quantile(.99))) for bd, s in d.groupby("band")}
        return self

    def base(self, d):
        bands = pband(d["place"].fillna(99))
        return np.array([self.tab.get((cg, bd), self.fallback.get(bd, 0.0)) for cg, bd in zip(d["cgroup"], bands)])


# ----------------------------------------------------------------------------------------------
# 5.  LEARNED LAYER + GUARD LAYER
# ----------------------------------------------------------------------------------------------
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier


class RatingModel:
    def __init__(self, use_text=True, seed=7):
        self.use_text = use_text
        self.feats = NUM_FEATURES + (TEXT_FEATURES if use_text else [])
        self.seed = seed

    def fit(self, d):
        d = d[d["runner"] & d["y"].notna() & (d["rat"] > 0)].copy()
        self.rule = RuleTable().fit(d)
        d["base"] = self.rule.base(d)
        usable = lambda x: [f for f in self.feats if x[f].astype(float).nunique(dropna=True) > 1]  # drop constant cols
        self.f_reg = usable(d)
        # (a) magnitude model on rule residual (all finishers)
        self.reg = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.05, max_depth=4,
                                                 min_samples_leaf=40, l2_regularization=2.0, random_state=self.seed)
        self.reg.fit(d[self.f_reg].astype(float), d["y"] - d["base"])
        # (b) downgrade-probability model for unplaced horses (the -2 / 0 decision)
        u = d[d["place"] >= 4]
        self.clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=3,
                                                  min_samples_leaf=40, l2_regularization=2.0, random_state=self.seed)
        self.f_clf = usable(u)
        self.clf.fit(u[self.f_clf].astype(float), (u["y"] <= -1).astype(int))
        self.down_level = float(u.loc[u["y"] <= -1, "y"].median())
        return self

    def predict(self, d):
        d = d.copy()
        d["base"] = self.rule.base(d)
        d["adj"] = self.reg.predict(d[self.f_reg].astype(float))
        d["p_down"] = np.where(d["place"] >= 4, self.clf.predict_proba(d[self.f_clf].astype(float))[:, 1], np.nan)
        raw = d["base"] + d["adj"]
        # unplaced horses: choose between 0 / -1 / -2 from the downgrade probability
        unpl = np.where(d["p_down"] >= .60, self.down_level,
                np.where(d["p_down"] <= .40, 0.0, -1.0))
        raw = np.where(d["place"] >= 4, unpl, raw)
        # GUARD layer - keep inside the band limits observed in BTC history
        lo = np.array([self.rule.limits.get(b, (-4, 30))[0] for b in pband(d["place"].fillna(99))])
        hi = np.array([self.rule.limits.get(b, (-4, 30))[1] for b in pband(d["place"].fillna(99))])
        d["rec"] = np.clip(np.round(raw), lo, hi)
        d.loc[~d["runner"], "rec"] = 0.0
        d["rec_raw"] = raw
        return d

    def text_effect(self, d):
        """change in the learned adjustment caused by the text variables alone (for the explanation)"""
        if not self.use_text:
            return np.zeros(len(d))
        z = d.copy()
        for c in TEXT_FEATURES:
            z[c] = 0.0 if c != "txt_vet_days" else 365.0
            if c in SAME_RACE:
                z[c] = np.nan
        return self.reg.predict(d[self.f_reg].astype(float)) - self.reg.predict(z[self.f_reg].astype(float))


# ----------------------------------------------------------------------------------------------
# 6.  JUSTIFICATION WRITER
# ----------------------------------------------------------------------------------------------
ORD = {1: "1st", 2: "2nd", 3: "3rd"}
FLAG_WORDS = {"gate_slow": "slow away from the gates", "gate_fly": "fly-jumped at the start",
              "gate_bad": "unruly/awkward at the start", "gate_cert_revoked": "barred pending gate/mock-race clearance",
              "vet_lame": "lameness", "vet_bleed": "bleeding (EIPH/epistaxis)", "vet_injury": "a leg/body injury",
              "vet_withdrawn": "a veterinary withdrawal", "vet_resp": "a respiratory remark",
              "behav_hang": "hanging in/out", "behav_green": "running green", "behav_detached": "running detached / not extending",
              "behav_fierce": "pulling hard early", "indifferent_ride": "an 'indifferent race' ride report",
              "hardluck": "traffic trouble / not getting a clear run", "trainer_warn": "a stewards' note to the trainer",
              "enquiry_form": "a stewards' enquiry into form reversal", "jockey_discipline": "jockey disciplined in the horse's race",
              "vet_clear": "vet-checked clear"}


def lengths(x):
    return "n/a" if pd.isna(x) else (f"{x:.2f}".rstrip("0").rstrip(".") + " L")


def justify(r, ev_h, txt_eff, rule_base):
    p, cat, rat = r["place"], r["cat"], r["rating"]
    parts = []
    if not r["runner"]:
        return "Non-runner / no recorded placing - no performance basis for a revision; rating left unchanged."
    # 1. result
    res = f"Finished {ORD.get(int(p), str(int(p)) + 'th')} of {int(r['nrun'])} in a {cat} race at {int(r['dist'])} m"
    if p == 1 and not pd.isna(r["win_margin"]):
        res += f", winning by {lengths(r['win_margin'])}"
    elif p > 1 and not pd.isna(r["btn"]):
        res += f", beaten {lengths(r['btn'])}"
    if not pd.isna(r["tbtn"]) and p > 1:
        res += f" ({r['tbtn']:.2f}s behind the winner)"
    parts.append(res + ".")
    # 2. rule layer
    parts.append(f"BTC history for {cat}-type horses finishing {ORD.get(int(p), '4th or worse')}: typical change "
                 f"{rule_base:+.0f}.")
    # 3. learned layer
    notes = []
    if p == 1:
        if not pd.isna(r["win_margin"]):
            notes.append("wide winning margin" if r["win_margin"] >= 3 else "narrow margin" if r["win_margin"] <= 0.75 else "")
        if not pd.isna(r["speed_idx"]):
            notes.append("time faster than par for the distance" if r["speed_idx"] < -0.4 else
                         "slower-than-par time" if r["speed_idx"] > 0.6 else "")
        if r["wins_prior"] and r["wins_prior"] >= 2:
            notes.append(f"{int(r['wins_prior'])} earlier wins on record")
        if not pd.isna(r["rat_rel"]):
            notes.append("top-rated in the field" if r["topweight"] else "rated below the field's top")
    elif p <= 3:
        if not pd.isna(r["btn"]):
            notes.append(f"{lengths(r['btn'])} off the winner")
        if not pd.isna(r["prev_place"]) and r["prev_place"] <= 3:
            notes.append("consistent recent form")
    else:
        if not pd.isna(r["p_down"]):
            parts.append(f"Statistical downgrade likelihood for unplaced runners with this profile: {r['p_down']*100:.0f}%.")
        if not pd.isna(r["prev_place"]) and r["prev_place"] >= 6:
            notes.append("poor previous run too")
        if not pd.isna(r["days_since"]) and r["days_since"] > 90:
            notes.append(f"{int(r['days_since'])}-day layoff")
        if not pd.isna(r["btn"]) and r["btn"] <= 3:
            notes.append("close enough to the winner to soften a cut")
    notes = [n for n in notes if n]
    if notes:
        parts.append("Numerical indicators: " + ", ".join(notes) + f" (model adjustment to the rule value {r['adj']:+.1f}).")
    # 4. text layer
    if ev_h is not None and len(ev_h):
        recent = ev_h[ev_h["flag"] != "vet_clear"].sort_values("date")
        if len(recent):
            bits = []
            for fl, grp in recent.groupby("flag"):
                last = grp["date"].max().strftime("%d-%b-%y")
                bits.append(f"{FLAG_WORDS.get(fl, fl)} ({last})")
            eff = "" if abs(txt_eff) < 0.5 else f"; text-variable effect on the model {txt_eff:+.1f} pts"
            parts.append("Steward/vet/starter reports (last 12 months): " + "; ".join(bits[:5]) + eff + ".")
        else:
            parts.append("Reports show only routine vet clearances - no adverse remarks.")
    else:
        parts.append("No adverse remarks in the steward/vet/starter/incident reports.")
    # 5. outcome
    new = max(0, rat + r["rec"]) if not pd.isna(rat) else np.nan
    msg = f"Recommendation {int(r['rec']):+d} -> new rating {new:.0f}"
    if cat in CAT_BAND and not pd.isna(new):
        hi = CAT_BAND[cat][1]
        if new > hi:
            msg += f" (rises above the {cat} ceiling of {hi}: moves up a class)"
    parts.append(msg + ".")
    return " ".join(parts)


# ----------------------------------------------------------------------------------------------
# 7.  VALIDATION  (chronological hold-out)
# ----------------------------------------------------------------------------------------------
def validate(feat, split="2026-05-01"):
    tr = feat[(~feat["is_target"]) & (feat["d"] < split)]
    te = feat[(~feat["is_target"]) & (feat["d"] >= split) & feat["runner"] & feat["y"].notna() & (feat["rat"] > 0)]
    rows = []
    rule = RuleTable().fit(tr[tr["runner"] & tr["y"].notna()])
    te = te.copy(); te["base"] = rule.base(te)
    rows.append(("Rule table only", np.round(te["base"])))
    for name, ut in [("Rule + numeric model", False), ("Hybrid: rule + numeric + text", True)]:
        m = RatingModel(use_text=ut).fit(tr[tr["runner"]])
        rows.append((name, m.predict(te)["rec"]))
    # same hybrid model, but with the same-day reports hidden - this is the situation for the BWM meeting
    te_blind = te.copy()
    te_blind[SAME_RACE] = np.nan
    rows.append(("Hybrid, same-day reports unavailable", m.predict(te_blind)["rec"]))
    print(f"\nHold-out: train < {split} ({len(tr)} rows) | test >= {split} ({len(te)} rows)")
    print(f"{'Model':34s} {'MAE':>6s} {'exact':>7s} {'within2':>8s}")
    for n, p in rows:
        e = (p.values - te["y"].values)
        print(f"{n:34s} {np.abs(e).mean():6.2f} {np.mean(e == 0):7.1%} {np.mean(np.abs(e) <= 2):8.1%}")


# ----------------------------------------------------------------------------------------------
# 8.  MAIN
# ----------------------------------------------------------------------------------------------
def main(a):
    from openpyxl import load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    bsm, bwm = load_bsm(a.bsm), load_bwm(a.bwm)
    names = set(bsm["horse"].dropna().str.strip()) | set(bwm["horse"].str.strip())
    paths = {"stewards": a.stipe, "vet": a.vet, "starter": a.starter, "incident": a.incidence}
    ev = mine_reports(paths, names)
    print(f"Report events mined: {len(ev)} for {ev['horse'].nunique()} horses "
          f"({ev['date'].min():%d-%b-%Y} to {ev['date'].max():%d-%b-%Y})")

    all_rows = pd.concat([bsm, bwm], ignore_index=True)
    all_rows["horse"] = all_rows["horse"].str.strip()
    feat = build_features(all_rows, ev)
    if a.validate:
        validate(feat)

    model = RatingModel(use_text=True).fit(feat[~feat["is_target"]])
    tgt = feat[feat["is_target"]].copy()
    tgt = model.predict(tgt)
    tgt["text_eff"] = model.text_effect(tgt)
    tgt["rule_base"] = model.rule.base(tgt)
    tgt = tgt.sort_values("src_row")

    ev_by_h = {h: g for h, g in ev.groupby("horse")} if len(ev) else {}
    out_chg, out_new, out_just = [], [], []
    for _, r in tgt.iterrows():
        eh = ev_by_h.get(r["horse"])
        if eh is not None:
            eh = eh[(eh["date"] < r["d"]) & (eh["date"] >= r["d"] - pd.Timedelta(days=365))]
        j = justify(r, eh, r["text_eff"], r["rule_base"])
        out_chg.append(0 if not r["runner"] else int(r["rec"]))
        out_new.append(int(r["rating"]) if not r["runner"] else int(max(0, r["rating"] + r["rec"])))
        out_just.append(j)

    wb = load_workbook(a.bwm)
    ws = wb.worksheets[0]
    c0 = ws.max_column + 1
    heads = ["Recommended Rating Change", "Proposed New Rating", "Justification"]
    for i, h in enumerate(heads):
        c = ws.cell(row=1, column=c0 + i, value=h)
        c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F4E78")
        c.alignment = Alignment(wrap_text=True, vertical="center")
    for k in range(len(out_just)):
        ws.cell(row=2 + k, column=c0, value=out_chg[k])
        ws.cell(row=2 + k, column=c0 + 1, value=out_new[k])
        cj = ws.cell(row=2 + k, column=c0 + 2, value=out_just[k]); cj.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions[get_column_letter(c0)].width = 16
    ws.column_dimensions[get_column_letter(c0 + 1)].width = 14
    ws.column_dimensions[get_column_letter(c0 + 2)].width = 110
    ws.freeze_panes = "A2"
    # evidence sheet
    es = wb.create_sheet("Report Evidence")
    es.append(["Horse", "Report date", "Source", "Flag", "Remark (truncated)"])
    bw_h = set(bwm["horse"].str.strip())
    for _, e in ev[ev["horse"].isin(bw_h)].sort_values(["horse", "date"]).iterrows():
        es.append([e["horse"], e["date"].date(), e["source"], e["flag"], e["text"]])
    for c in es[1]:
        c.font = Font(bold=True)
    es.column_dimensions["A"].width = 24; es.column_dimensions["E"].width = 120
    wb.save(a.out)
    print("Saved:", a.out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="BTC rating-change recommender")
    ap.add_argument("--bsm", required=True); ap.add_argument("--bwm", required=True)
    ap.add_argument("--stipe"); ap.add_argument("--vet"); ap.add_argument("--starter"); ap.add_argument("--incidence")
    ap.add_argument("--out", default="BWM_with_recommended_ratings.xlsx")
    ap.add_argument("--validate", action="store_true", help="print chronological hold-out accuracy")
    main(ap.parse_args())
