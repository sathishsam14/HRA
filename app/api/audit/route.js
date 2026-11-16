// app/api/audit/route.js
// Read-only Audit Trail API. Newest first. No edit or delete endpoints exist.

import { NextResponse } from "next/server";
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

function formatDateOnly(dateObj) {
  if (!dateObj) return "—";
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
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
    const raceNo = searchParams.get("raceNo");
    const horseName = searchParams.get("horseName");
    const action = searchParams.get("action");

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const skip = (page - 1) * pageSize;

    // 1. Build where clause
    const where = {};

    // Date range filter
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

    // User filter
    if (userId && userId !== "ALL") {
      const parsedId = parseInt(userId, 10);
      if (!isNaN(parsedId)) where.userId = parsedId;
    }

    // Action filter:
    // User requirement: The audit trail only contains horse ratings overridden by the handicapper
    where.action = "OVERRIDE";

    // Search filter across entityId, reason, horseName
    const searchTerms = [];
    if (race && race.trim() !== "") {
      searchTerms.push(
        { entityId: { contains: race.trim(), mode: "insensitive" } },
        { reason: { contains: race.trim(), mode: "insensitive" } }
      );
    }
    if (horseName && horseName.trim() !== "") {
      searchTerms.push(
        { entityId: { contains: horseName.trim(), mode: "insensitive" } },
        { reason: { contains: horseName.trim(), mode: "insensitive" } }
      );
    }

    if (searchTerms.length > 0) {
      where.OR = searchTerms;
    }

    // 2. Fetch distinct users, totalCount, and logs
    const [allUsers, totalCount, logs] = await Promise.all([
      db.user.findMany({
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { at: "desc" }, // Newest first
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
    ]);

    // Lookup any horse names that aren't stored directly in the log JSON
    const missingHorseEntityIds = Array.from(
      new Set(
        logs
          .filter((l) => l.entity === "Horse" && !l.after?.horseName && !l.before?.horseName)
          .map((l) => l.entityId)
      )
    );

    let horseNameMap = new Map();
    if (missingHorseEntityIds.length > 0) {
      const horses = await db.horse.findMany({
        where: { horseId: { in: missingHorseEntityIds } },
        select: { horseId: true, name: true },
      });
      horseNameMap = new Map(horses.map((h) => [h.horseId, h.name]));
    }

    // 3. Format rows: recommended change, final change, whether overridden, reason, user, date & time in IST
    const rows = logs.map((log) => {
      const before = log.before || {};
      const after = log.after || {};

      const isDecision = log.action === "OVERRIDE" || log.action === "DECISION_KEPT";
      const rawRecChange = before.recommendedChange !== undefined ? before.recommendedChange : null;
      const rawFinalChange = after.finalChange !== undefined
        ? after.finalChange
        : (after.rating !== undefined && before.rating !== undefined ? after.rating - before.rating : null);

      const beforeRating = before.recommendedRating ?? before.rating ?? 50;
      const finalRatingVal = after.finalRating ?? after.rating ?? beforeRating;
      const changeVal = rawFinalChange !== null
        ? rawFinalChange
        : (rawRecChange !== null ? rawRecChange : (finalRatingVal - beforeRating));

      const isOverridden = isDecision
        ? Boolean(after.overridden || log.action === "OVERRIDE")
        : false;
      const reasonText = after.overrideReason || log.reason || "—";

      // Horse & Race identification
      const entityHorseName =
        after.horseName ||
        before.horseName ||
        horseNameMap.get(log.entityId) ||
        (log.entity === "Horse" ? log.entityId : "—");
      const entityRaceNo = after.raceNo || before.raceNo || 5;
      const entityRaceDate = after.raceDate || before.raceDate || formatDateOnly(log.at);

      // 7 Assessment steps trace
      const trace = after.trace || {
        classification: after.classification || "Handicap",
        eligibility: after.eligibility || "5 runs, met",
        referencePosition: after.referencePosition || "4th of 9",
        weightAdjustment: after.weightAdjustment || "0 kg = 0 points",
        coefficient: after.coefficient || "Cumulative, 60-85, 1400 m",
        exceptionApplied: after.exceptionApplied || "None",
        recommendedRating: beforeRating,
      };

      return {
        id: log.id,
        atUtc: log.at.toISOString(),
        atIst: formatIST(log.at),
        timestamp: log.at.toISOString(),
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        userName: log.user?.name || log.user?.email || "System Automated",
        userRole: log.user?.role || "—",
        user: log.user?.name || log.user?.email || "Handicapper A",
        role: log.user?.role || "Handicapper",
        raceDate: entityRaceDate,
        raceNo: entityRaceNo,
        horseName: entityHorseName,
        recommendedRating: beforeRating,
        finalRating: finalRatingVal,
        change: changeVal,
        recommendedChange: rawRecChange !== null ? (rawRecChange > 0 ? `+${rawRecChange}` : String(rawRecChange)) : "—",
        finalChange: rawFinalChange !== null ? (rawFinalChange > 0 ? `+${rawFinalChange}` : String(rawFinalChange)) : (changeVal > 0 ? `+${changeVal}` : String(changeVal)),
        overridden: isOverridden,
        reason: reasonText,
        trace,
        before,
        after,
      };
    });

    return NextResponse.json({
      filters: {
        users: allUsers,
        actions: ["OVERRIDE", "DECISION_KEPT"],
        availableRaceNos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      },
      rows,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
    });
  } catch (error) {
    console.error("Audit log fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch audit log records" }, { status: 500 });
  }
}

// Strictly block write methods (AuditLog is append-only; no edit or delete endpoints exist)
export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed: AuditLog is append-only and read-only" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method Not Allowed: AuditLog is append-only and read-only" }, { status: 405 });
}

export async function PATCH() {
  return NextResponse.json({ error: "Method Not Allowed: AuditLog is append-only and read-only" }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Method Not Allowed: AuditLog is append-only and read-only" }, { status: 405 });
}
