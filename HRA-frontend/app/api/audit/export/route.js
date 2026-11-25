// app/api/audit/export/route.js
// Exports filtered Audit Trail to an Excel spreadsheet (.xlsx) with timestamps displayed in IST.

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import db from "@/lib/db";
import { getSession } from "@/lib/auth";

function formatIST(dateObj) {
  if (!dateObj) return "—";
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d) + " IST"
  );
}

export async function GET(request) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const userId = searchParams.get("userId");
    const race = searchParams.get("race");
    const action = searchParams.get("action");

    const where = {};
    if (startDate || endDate) {
      where.at = {};
      if (startDate) {
        const s = new Date(startDate);
        if (!isNaN(s.getTime())) where.at.gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        if (!isNaN(e.getTime())) {
          e.setHours(23, 59, 59, 999);
          where.at.lte = e;
        }
      }
    }
    if (userId && userId !== "ALL") {
      const parsedId = parseInt(userId, 10);
      if (!isNaN(parsedId)) where.userId = parsedId;
    }
    // Only export ratings overridden by the handicapper
    where.action = "OVERRIDE";
    if (race && race.trim() !== "") {
      const term = race.trim();
      where.OR = [
        { entityId: { contains: term, mode: "insensitive" } },
        { reason: { contains: term, mode: "insensitive" } },
      ];
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      include: {
        user: { select: { name: true, email: true, role: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BTC HRA Audit System";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Audit Trail");

    sheet.columns = [
      { header: "Date & Time (IST)", key: "timestampIst", width: 26 },
      { header: "Action", key: "action", width: 16 },
      { header: "Recommended Change", key: "recChange", width: 20 },
      { header: "Final Change", key: "finalChange", width: 16 },
      { header: "Overridden", key: "overridden", width: 14 },
      { header: "Reason", key: "reason", width: 36 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF12306B" },
    };
    headerRow.height = 24;

    for (const log of logs) {
      const before = log.before || {};
      const after = log.after || {};

      const isDecision = log.action === "OVERRIDE" || log.action === "DECISION_KEPT";
      const recChange = isDecision && before.recommendedChange !== undefined ? before.recommendedChange : null;
      const finalChange = isDecision && after.finalChange !== undefined ? after.finalChange : null;
      const isOverridden = isDecision ? Boolean(after.overridden || log.action === "OVERRIDE") : false;

      sheet.addRow({
        timestampIst: formatIST(log.at),
        action: log.action,
        recChange: recChange !== null ? (recChange > 0 ? `+${recChange}` : String(recChange)) : "—",
        finalChange: finalChange !== null ? (finalChange > 0 ? `+${finalChange}` : String(finalChange)) : "—",
        overridden: isOverridden ? "Yes" : "No",
        reason: after.overrideReason || log.reason || "—",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="HRA_Audit_Trail_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Audit export error:", error);
    return NextResponse.json({ error: "Failed to export audit trail" }, { status: 500 });
  }
}
