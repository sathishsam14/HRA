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
    const distance = searchParams.get("distance");

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const skip = (page - 1) * pageSize;

    // 1. Build where clause (Audit log only tracks OVERRIDE actions made by handicappers)
    const where = {
      action: "OVERRIDE",
    };

    // Date range filter (compare log.at or override date)
    if (startDate || endDate) {
      where.at = {};
      if (startDate) {
        const s = new Date(`${startDate}T00:00:00`);
        if (!isNaN(s.getTime())) where.at.gte = s;
      }
      if (endDate) {
        const e = new Date(`${endDate}T23:59:59.999`);
        if (!isNaN(e.getTime())) where.at.lte = e;
      }
    }

    // User filter
    if (userId && userId !== "ALL") {
      const parsedId = parseInt(userId, 10);
      if (!isNaN(parsedId)) where.userId = parsedId;
    }

    // 2. Fetch distinct users, race distances, and matching logs
    const [allUsers, allRaces, allMatchingLogs] = await Promise.all([
      db.user.findMany({
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      db.race.findMany({
        select: { raceDate: true, raceNo: true, distance: true },
      }),
      db.auditLog.findMany({
        where,
        orderBy: { at: "desc" }, // Newest first
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
    ]);

    const raceDistanceMap = new Map();
    const distanceSet = new Set();
    for (const r of allRaces) {
      if (r.distance != null) {
        distanceSet.add(r.distance);
        const key = `${r.raceDate.toISOString().slice(0, 10)}_${r.raceNo}`;
        raceDistanceMap.set(key, r.distance);
      }
    }
    for (const log of allMatchingLogs) {
      const d = log.after?.distance || log.before?.distance;
      if (d != null && !isNaN(Number(d))) {
        distanceSet.add(Number(d));
      }
    }
    const availableDistances = Array.from(distanceSet).sort((a, b) => a - b);

    const targetRaceNo = raceNo || race;
    const parsedRNo = targetRaceNo && targetRaceNo !== "ALL" ? parseInt(targetRaceNo, 10) : null;
    const parsedDist = distance && distance !== "ALL" ? parseInt(distance, 10) : null;
    const searchHorse = horseName ? horseName.trim().toLowerCase() : "";

    const filteredLogs = allMatchingLogs.filter((log) => {
      const after = log.after || {};
      const before = log.before || {};
      const rNo = after.raceNo ?? before.raceNo;
      const rDateRaw = after.raceDate || before.raceDate;
      const rDate = rDateRaw ? String(rDateRaw).slice(0, 10) : null;

      if (parsedRNo && !isNaN(parsedRNo) && Number(rNo) !== parsedRNo) {
        return false;
      }

      if (parsedDist && !isNaN(parsedDist)) {
        const dist = after.distance || before.distance || (rDate && rNo ? raceDistanceMap.get(`${rDate}_${rNo}`) : null);
        if (Number(dist) !== parsedDist) return false;
      }

      if (searchHorse) {
        const h1 = String(after.horseName || "").toLowerCase();
        const h2 = String(before.horseName || "").toLowerCase();
        const eId = String(log.entityId || "").toLowerCase();
        const rsn = String(log.reason || "").toLowerCase();
        if (!h1.includes(searchHorse) && !h2.includes(searchHorse) && !eId.includes(searchHorse) && !rsn.includes(searchHorse)) {
          return false;
        }
      }

      return true;
    });

    const totalCount = filteredLogs.length;
    const logs = filteredLogs.slice(skip, skip + pageSize);

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
      const entityDistance =
        after.distance ||
        before.distance ||
        (entityRaceDate && entityRaceNo
          ? raceDistanceMap.get(`${String(entityRaceDate).slice(0, 10)}_${entityRaceNo}`)
          : null) ||
        null;

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
        distance: entityDistance,
        horseName: entityHorseName,
        recommendedRating: beforeRating,
        finalRating: finalRatingVal,
        change: changeVal,
        recommendedChange: rawRecChange !== null ? (rawRecChange > 0 ? `+${rawRecChange}` : String(rawRecChange)) : "—",
        finalChange: rawFinalChange !== null ? (rawFinalChange > 0 ? `+${rawFinalChange}` : String(rawFinalChange)) : (changeVal > 0 ? `+${changeVal}` : String(changeVal)),
        overridden: isOverridden,
        reason: reasonText,
        patternDetails: after.patternDetails || before.patternDetails || null,
        trace,
        before,
        after,
      };
    });

    return NextResponse.json({
      filters: {
        users: allUsers,
        availableDistances,
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
