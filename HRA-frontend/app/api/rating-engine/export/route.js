// app/api/rating-engine/export/route.js
// Exports rated race entrants to Excel with all original current race columns
// plus Recommended_Change_Rating, New_Rating, Justification, Report_Remarks, Handicapper_Decision.
// Available to all authenticated roles (Admin, Handicapper, Manager).

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadRaceExtrasLookup } from "@/lib/rating/raceExtras";
import { getPythonApiUrl } from "@/lib/pythonApi";
import {
  fetchReportEvidenceMap,
  formatReportRemarksForEntry,
} from "@/lib/rating/pythonData";

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const raceIdParam = searchParams.get("raceId");

    const where = {};
    if (raceIdParam && raceIdParam !== "ALL") {
      const parsedId = parseInt(raceIdParam, 10);
      if (!isNaN(parsedId)) {
        where.id = parsedId;
      }
    } else {
      where.status = "OPEN";
    }

    const races = await db.race.findMany({
      where,
      include: {
        entries: {
          include: {
            horse: true,
            rating: true,
            decision: {
              include: { user: { select: { name: true, role: true } } },
            },
          },
          orderBy: [
            { placing: "asc" },
            { id: "asc" },
          ],
        },
      },
      orderBy: [
        { raceDate: "asc" },
        { raceNo: "asc" },
      ],
    });

    if (!races.length) {
      return NextResponse.json(
        { error: "No race entries available to export." },
        { status: 404 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bangalore Turf Club - HRA Rating Engine";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Current Race Ratings", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    worksheet.columns = [
      { header: "venue", key: "venue", width: 10 },
      { header: "racedate", key: "racedate", width: 14 },
      { header: "raceseason", key: "raceseason", width: 26 },
      { header: "racecat", key: "racecat", width: 14 },
      { header: "raceno", key: "raceno", width: 10 },
      { header: "cardno", key: "cardno", width: 10 },
      { header: "distance", key: "distance", width: 12 },
      { header: "currat", key: "currat", width: 10 },
      { header: "HorseName", key: "HorseName", width: 24 },
      { header: "horswgt", key: "horswgt", width: 10 },
      { header: "shoe", key: "shoe", width: 16 },
      { header: "startstall", key: "startstall", width: 12 },
      { header: "jockey", key: "jockey", width: 20 },
      { header: "weightcd", key: "weightcd", width: 12 },
      { header: "placing", key: "placing", width: 10 },
      { header: "Timing", key: "Timing", width: 14 },
      { header: "Verdict", key: "Verdict", width: 12 },
      { header: "trainer", key: "trainer", width: 22 },
      { header: "pent", key: "pent", width: 12 },
      { header: "Railing Position", key: "railing", width: 26 },
      // Added rating & audit columns
      { header: "Recommended_Change_Rating", key: "recChange", width: 24 },
      { header: "Suggested_Rating", key: "suggestedRating", width: 16 },
      { header: "Final_Rating", key: "finalRating", width: 14 },
      { header: "Justification", key: "justification", width: 45 },
      { header: "Report_Remarks", key: "reportRemarks", width: 35 },
      { header: "Handicapper_Decision", key: "decision", width: 30 },
    ];

    // Header styling
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF12306B" }, // BTC Navy
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    const getRaceExtra = await loadRaceExtrasLookup();
    const allHorseNames = races.flatMap((r) => r.entries.map((e) => e.horse?.name).filter(Boolean));
    const evidenceRes = await fetchReportEvidenceMap(allHorseNames, getPythonApiUrl());

    for (const race of races) {
      const raceIsoDate = race.raceDate.toISOString().slice(0, 10);
      const raceDateStr = race.raceDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      for (const entry of race.entries) {
        const horse = entry.horse || {};
        const rating = entry.rating || null;
        const decision = entry.decision || null;

        const raceExtra = getRaceExtra({
          raceDate: race.raceDate,
          raceNo: race.raceNo,
          horseName: horse.name,
        });

        const startRating =
          raceExtra?.currat != null
            ? Number(raceExtra.currat)
            : rating?.recommendedRating != null && rating?.recommendedChange != null
            ? rating.recommendedRating - rating.recommendedChange
            : horse.currentRating ?? null;

        const recChange = rating?.recommendedChange ?? 0;
        const suggestedRating =
          startRating != null && rating?.recommendedChange != null
            ? startRating + recChange
            : (rating?.recommendedRating ?? startRating);

        const finalRating = decision
          ? decision.finalRating
          : startRating != null
          ? startRating + recChange
          : (rating?.recommendedRating ?? startRating);

        // Report Remarks (from Python /api/report-evidence)
        const horseUpper = String(horse.name || "").trim().toUpperCase();
        const pyEvents = evidenceRes.byHorse.get(horseUpper) || [];
        const reportRemarks = formatReportRemarksForEntry(pyEvents, raceIsoDate).exception;

        // Justification
        let justification = "—";
        if (rating?.reasons) {
          const arr = Array.isArray(rating.reasons) ? rating.reasons : [String(rating.reasons)];
          justification = arr.join(" ");
        }

        // Handicapper Decision
        let decisionText = "Pending Review";
        if (decision) {
          if (decision.overridden) {
            decisionText = `OVERRIDDEN (${decision.finalChange >= 0 ? "+" : ""}${decision.finalChange} pts): ${decision.overrideReason || "Manual override"} by ${decision.user?.name || "Handicapper"}`;
          } else {
            decisionText = `ACCEPTED (${decision.finalChange >= 0 ? "+" : ""}${decision.finalChange} pts) by ${decision.user?.name || "Handicapper"}`;
          }
        }

        worksheet.addRow({
          venue: race.venue,
          racedate: raceDateStr,
          raceseason: race.season || "2026-27",
          racecat: race.category,
          raceno: race.raceNo,
          cardno: race.cardNo ?? 1,
          distance: race.distance,
          currat: startRating,
          HorseName: horse.name,
          horswgt: entry.horseWeight,
          shoe: entry.shoes,
          startstall: entry.startGate,
          jockey: entry.jockey,
          weightcd: entry.weightCarried,
          placing: entry.placing,
          Timing: entry.timing,
          Verdict: entry.verdict,
          trainer: entry.trainer || horse.trainer,
          pent: entry.penetrometer ? `${entry.penetrometer} cm` : "—",
          railing: entry.railing || "Railing fixed at its original position.",
          recChange,
          suggestedRating,
          finalRating,
          justification,
          reportRemarks,
          decision: decisionText,
        });
      }
    }

    const buffer_horses = new Set();
    for (const race of races) {
      for (const entry of race.entries) {
        if (entry.horse?.name) buffer_horses.add(entry.horse.name.trim());
      }
    }

    // Add "Report Evidence" sheet matching client's Output.xlsx
    const evidenceSheet = workbook.addWorksheet("Report Evidence");
    evidenceSheet.columns = [
      { header: "Horse", key: "horse", width: 24 },
      { header: "Report date", key: "reportDate", width: 14 },
      { header: "Source", key: "source", width: 14 },
      { header: "Flag", key: "flag", width: 20 },
      { header: "Remark (truncated)", key: "remark", width: 120 },
    ];
    evidenceSheet.getRow(1).font = { bold: true };

    try {
      const evRes = await fetch(`${getPythonApiUrl()}/api/report-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horses: Array.from(buffer_horses) }),
      });
      if (evRes.ok) {
        const evData = await evRes.json();
        if (evData.success && Array.isArray(evData.evidence)) {
          for (const evRow of evData.evidence) {
            const evDateObj = evRow.report_date ? new Date(evRow.report_date) : null;
            const evDateFormatted = evDateObj && !isNaN(evDateObj.getTime())
              ? evDateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
              : evRow.report_date;
            evidenceSheet.addRow({
              horse: evRow.horse,
              reportDate: evDateFormatted,
              source: evRow.source,
              flag: evRow.flag,
              remark: evRow.remark,
            });
          }
        }
      }
    } catch (evErr) {
      console.warn("Could not fetch report evidence from Python backend for export:", evErr.message);
    }

    const buffer = await workbook.xlsx.writeBuffer();

    const fileName =
      raceIdParam && raceIdParam !== "ALL"
        ? `BTC_Race_${races[0]?.raceNo || "Rating"}_Export.xlsx`
        : `BTC_Current_Race_Ratings_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export Excel ratings:", error);
    return NextResponse.json(
      { error: "Internal server error while exporting Excel" },
      { status: 500 }
    );
  }
}
