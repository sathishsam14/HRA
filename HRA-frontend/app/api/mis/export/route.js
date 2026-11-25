// app/api/mis/export/route.js
// Exports filtered MIS report data across the 27 statutory columns as a formatted Excel spreadsheet (.xlsx).

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPythonApiUrl } from "@/lib/pythonApi";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const venue = searchParams.get("venue");
    const raceDate = searchParams.get("raceDate");
    const season = searchParams.get("season");
    const raceType = searchParams.get("raceType");
    const category = searchParams.get("category");
    const horseName = searchParams.get("horseName");

    // Only confirmed REVIEWED races
    const raceWhere = {
      status: "REVIEWED",
    };
    if (venue && venue !== "ALL") raceWhere.venue = venue;
    if (raceDate && raceDate !== "ALL") {
      const d = new Date(raceDate);
      if (!isNaN(d.getTime())) raceWhere.raceDate = d;
    }
    if (season && season !== "ALL") raceWhere.season = season;
    if (raceType && raceType !== "ALL") {
      const upperType = raceType.toUpperCase();
      if (upperType === "HANDICAP" || upperType === "TERMS") {
        raceWhere.raceType = upperType;
      }
    }
    if (category && category !== "ALL") raceWhere.category = category;

    // Only races and entries confirmed by the Handicapper appear in the MIS report
    const entryWhere = {
      race: raceWhere,
      decision: { isNot: null },
    };
    if (horseName && horseName.trim() !== "") {
      entryWhere.horse = {
        name: { contains: horseName.trim(), mode: "insensitive" },
      };
    }

    const entries = await db.raceEntry.findMany({
      where: entryWhere,
      include: {
        race: true,
        horse: true,
        rating: true,
        decision: true,
      },
      orderBy: [
        { race: { raceDate: "desc" } },
        { race: { raceNo: "asc" } },
        { placing: "asc" },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BTC HRA Application";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("MIS Report");

    // 29 Statutory Columns matching official standard
    sheet.columns = [
      { header: "Venue", key: "venue", width: 10 },
      { header: "Race Date", key: "raceDate", width: 14 },
      { header: "Race Season", key: "raceSeason", width: 22 },
      { header: "Race Type – Handicap or Terms Race", key: "raceType", width: 28 },
      { header: "Race Category", key: "raceCategory", width: 16 },
      { header: "Race No", key: "raceNo", width: 10 },
      { header: "Card No", key: "cardNo", width: 10 },
      { header: "Distance", key: "distance", width: 12 },
      { header: "Current Rating", key: "currentRating", width: 15 },
      { header: "Horse Name", key: "horseName", width: 24 },
      { header: "Horse Weight", key: "horseWeight", width: 14 },
      { header: "Shoes", key: "shoes", width: 14 },
      { header: "Start Gate", key: "startGate", width: 12 },
      { header: "Weight Declare", key: "weightDeclare", width: 15 },
      { header: "Jockey", key: "jockey", width: 20 },
      { header: "Weight Carried", key: "weightCarried", width: 15 },
      { header: "Placing in the current Race", key: "placing", width: 22 },
      { header: "Timing", key: "timing", width: 12 },
      { header: "Verdict", key: "verdict", width: 12 },
      { header: "Trainer", key: "trainer", width: 22 },
      { header: "Penetrometer Reading", key: "penetrometer", width: 22 },
      { header: "Railing Position", key: "railing", width: 20 },
      { header: "Starter Report observations", key: "starterReport", width: 28 },
      { header: "Veterinary Report observations", key: "veterinaryReport", width: 28 },
      { header: "Incidence Report observations", key: "incidentReport", width: 28 },
      { header: "Rating Status", key: "status", width: 18 },
      { header: "Override - User override, if applicable", key: "override", width: 32 },
      { header: "Final Rating Change - Final approved change", key: "finalChange", width: 32 },
      { header: "Reason Explanation for decision", key: "reasonExplanation", width: 36 },
    ];

    // Header styling
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF12306B" }, // BTC Navy
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 24;

    for (const e of entries) {
      const r = e.race;
      const h = e.horse;
      const rating = e.rating;
      const decision = e.decision;

      const finalChange = decision ? decision.finalChange : (rating?.recommendedChange ?? null);
      const finalRating = decision ? decision.finalRating : (rating?.recommendedRating ?? h.currentRating ?? null);
      const reasonExplanation = decision?.overrideReason || (Array.isArray(rating?.reasons) ? rating.reasons.join("; ") : (rating?.reasons || "—"));

      sheet.addRow({
        venue: r.venue || "—",
        raceDate: r.raceDate.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
        raceSeason: r.season || "—",
        raceType: r.raceType || "—",
        raceCategory: r.category || "—",
        raceNo: r.raceNo,
        cardNo: r.cardNo !== null ? r.cardNo : "—",
        distance: r.distance ? `${r.distance} m` : "—",
        currentRating: finalRating !== null ? finalRating : (h.currentRating !== null ? h.currentRating : "—"),
        horseName: h.name || "—",
        horseWeight: e.horseWeight !== null ? `${e.horseWeight} kg` : "—",
        shoes: e.shoes || "—",
        startGate: e.startGate !== null ? e.startGate : "—",
        weightDeclare: e.weightDeclare !== null ? `${e.weightDeclare} kg` : "—",
        jockey: e.jockey || "—",
        weightCarried: e.weightCarried !== null ? `${e.weightCarried} kg` : "—",
        placing: e.placing !== null ? e.placing : "—",
        timing: e.timing || "—",
        verdict: e.verdict || "—",
        trainer: e.trainer || h.trainer || "—",
        penetrometer: e.penetrometer !== null ? e.penetrometer : "—",
        railing: e.railing || "—",
        starterReport: e.starterRemark || "—",
        veterinaryReport: e.veterinaryRemark || "—",
        incidentReport: e.incidentRemark || "—",
        status: decision ? (decision.overridden ? "OVERRIDDEN" : "RATED") : (rating ? rating.status : "REVIEWED"),
        override: decision ? (decision.overridden ? "Yes" : "No") : "No",
        finalChange: finalChange !== null ? (finalChange > 0 ? `+${finalChange}` : String(finalChange)) : "—",
        reasonExplanation: reasonExplanation || "Approved recommendation",
      });
    }

    // Also include filtered Master BSM records so Export Excel matches MIS table
    try {
      const mRes = await fetch(`${getPythonApiUrl()}/api/master-records`, { cache: "no-store" });
      if (mRes.ok) {
        const mData = await mRes.json();
        if (mData.success && Array.isArray(mData.rows)) {
          const searchHorse = horseName ? horseName.trim().toLowerCase() : "";
          for (const mr of mData.rows) {
            if (venue && venue !== "ALL" && mr.venue !== venue) continue;
            if (raceDate && raceDate !== "ALL" && mr.raceDate !== raceDate) continue;
            if (season && season !== "ALL" && mr.raceSeason !== season) continue;
            if (raceType && raceType !== "ALL" && String(mr.raceType).toUpperCase() !== raceType.toUpperCase()) continue;
            if (category && category !== "ALL" && mr.raceCategory !== category) continue;
            if (searchHorse && !String(mr.horseName).toLowerCase().includes(searchHorse)) continue;
            const mrDateObj = mr.raceDate && mr.raceDate !== "—" ? new Date(mr.raceDate) : null;
            const mrDateFormatted = mrDateObj && !isNaN(mrDateObj.getTime())
              ? mrDateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
              : (mr.raceDateFormatted || mr.raceDate);
            sheet.addRow({
              venue: mr.venue,
              raceDate: mrDateFormatted,
              raceSeason: mr.raceSeason,
              raceType: mr.raceType,
              raceCategory: mr.raceCategory,
              raceNo: mr.raceNo,
              cardNo: mr.cardNo,
              distance: mr.distance,
              currentRating: mr.currentRating,
              horseName: mr.horseName,
              horseWeight: mr.horseWeight,
              shoes: mr.shoes,
              startGate: mr.startGate,
              weightDeclare: mr.weightDeclare,
              jockey: mr.jockey,
              weightCarried: mr.weightCarried,
              placing: mr.placing,
              timing: mr.timing,
              verdict: mr.verdict,
              trainer: mr.trainer,
              penetrometer: mr.penetrometer,
              railing: mr.railing,
              starterReport: mr.starterReport,
              veterinaryReport: mr.veterinaryReport,
              incidentReport: mr.incidentReport,
              status: mr.status,
              override: mr.override,
              finalChange: mr.finalChange,
              reasonExplanation: mr.reasonExplanation,
            });
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch master BSM records for MIS export:", err.message);
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="HRA_MIS_Report_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("MIS Excel export error:", error);
    return NextResponse.json({ error: "Failed to export MIS report" }, { status: 500 });
  }
}
