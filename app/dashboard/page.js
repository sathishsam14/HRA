"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import Pill from "@/components/Pill";
import { useData } from "@/lib/DataContext";
import { ArrowRight } from "lucide-react";

function formatDisplayDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatAuditTime(timestamp, todayStr = "2026-11-07") {
  if (!timestamp) return "-";
  const [datePart, timePart] = timestamp.split("T");
  const time = timePart || "";

  if (datePart === todayStr) {
    return `Today ${time}`;
  }

  const todayD = new Date(todayStr);
  const itemD = new Date(datePart);
  const diffDays = Math.round((todayD - itemD) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    return `Yesterday ${time}`;
  }

  try {
    const d = new Date(timestamp);
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleDateString("en-GB", { month: "short" });
    return `${day} ${month} ${time}`;
  } catch {
    return timestamp;
  }
}

function DashboardContent() {
  const { races, horses, audit, dashboard, today } = useData();

  if (!races || races.length === 0) {
    console.log("Dashboard data verification:", { races, dashboard, horses });
  }

  // 1. KPI: Races waiting for review (status !== 'Reviewed')
  const waitingRaces = races.filter((r) => r.status !== "Reviewed");
  const waitingCount = waitingRaces.length;

  // Find oldest date among waiting races
  const oldestDate = waitingRaces.reduce((oldest, r) => {
    if (!oldest) return r.date;
    return new Date(r.date) < new Date(oldest) ? r.date : oldest;
  }, "");
  const oldestFormatted = oldestDate ? formatDisplayDate(oldestDate) : "—";

  // 2. KPI: Reviewed this week
  const reviewedThisWeek = dashboard?.reviewedThisWeek ?? 14;
  const reviewedDelta = dashboard?.reviewedDelta ?? 3;

  // 3. KPI: Overrides this month (count of horses with override = true)
  const overriddenHorses = horses.filter((h) => h.override === true);
  const overrideCount = overriddenHorses.length;
  const overridePercentage =
    horses.length > 0 ? Math.round((overrideCount / horses.length) * 100) : 0;

  // 4. KPI: Last FTP pick-up
  const ftpPickup = dashboard?.lastFtpPickup || {
    status: "Received",
    time: "2026-11-07T06:10",
  };
  const ftpTimeFormatted = (() => {
    if (!ftpPickup.time) return "—";
    const [dPart, tPart] = ftpPickup.time.split("T");
    return `${formatDisplayDate(dPart)}, ${tPart || ""}`;
  })();

  // Sort races newest first (by date descending, then raceNo descending)
  const sortedRaces = [...races].sort((a, b) => {
    const dateComp = new Date(b.date) - new Date(a.date);
    if (dateComp !== 0) return dateComp;
    return (b.raceNo || 0) - (a.raceNo || 0);
  });

  // Recent 4 overrides from audit data
  const recentOverrides = (audit || []).slice(0, 4);

  // Alerts from dashboard.alerts
  const alerts = dashboard?.alerts || [];

  return (
    <div className="space-y-6">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Races waiting for review */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Races waiting for review
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {waitingCount}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Oldest: {oldestFormatted}
          </div>
        </div>

        {/* Card 2: Reviewed this week */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Reviewed this week
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {reviewedThisWeek}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            +{reviewedDelta} compared with last week
          </div>
        </div>

        {/* Card 3: Overrides this month */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Overrides this month
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {overrideCount}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {overridePercentage}% of horses rated
          </div>
        </div>

        {/* Card 4: Last FTP pick-up */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Last FTP pick-up
          </div>
          <div className="mt-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#166534]" />
              {ftpPickup.status || "Received"}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-2.5">
            {ftpTimeFormatted}
          </div>
        </div>
      </div>

      {/* Main Grid: Left (Races waiting for review) & Right (Needs attention + Recent overrides) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Races waiting for review table */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
          {/* Card Header */}
          <div className="px-6 py-5 flex items-center justify-between border-b border-[#E2E8F0]">
            <h2 className="text-base font-semibold text-slate-900">
              Races waiting for review
            </h2>
            <Link
              href="/rating-engine"
              className="text-xs font-medium text-[#2563EB] hover:underline"
            >
              View all
            </Link>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                    RACE NO
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                    DATE
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                    CATEGORY
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                    DISTANCE
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                    RUNNERS
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                    STATUS
                  </th>
                  <th className="px-5 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                    ACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6]">
                {sortedRaces.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-8 text-center text-xs text-slate-400"
                    >
                      No races waiting for review
                    </td>
                  </tr>
                ) : (
                  sortedRaces.map((race) => {
                    const isReviewed = race.status === "Reviewed";
                    const isPartly = race.status === "Partly reviewed";

                    return (
                      <tr
                        key={race.id}
                        className="h-[52px] hover:bg-[#F8FAFC] transition-colors"
                      >
                        <td className="px-5 py-3 text-sm font-medium text-slate-900 whitespace-nowrap">
                          Race {race.raceNo ?? race.id}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {formatDisplayDate(race.date)}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {race.category || "—"}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 whitespace-nowrap">
                          {race.distance ? `${race.distance} m` : "—"}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 text-center whitespace-nowrap tabular-nums">
                          {race.runners ?? "—"}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {isReviewed ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#166534]" />
                              Reviewed
                            </span>
                          ) : isPartly ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#64748B]" />
                              Partly reviewed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                              Awaiting review
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Link
                            href={`/rating-engine/?race=${race.id}`}
                            className="inline-flex items-center justify-center px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-[#CBD5E1] rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (4 cols): Needs attention & Recent overrides */}
        <div className="lg:col-span-4 space-y-6">
          {/* Card: Needs attention */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Needs attention
            </h2>
            <div className="divide-y divide-[#EEF2F6]">
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">No alerts</p>
              ) : (
                alerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#D97706] mt-1.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-slate-900 leading-snug">
                        {alert.text}
                      </div>
                      {alert.detail && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {alert.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card: Recent overrides */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Recent overrides
            </h2>
            <div className="divide-y divide-[#EEF2F6]">
              {recentOverrides.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">
                  No overrides recorded yet
                </p>
              ) : (
                recentOverrides.map((item, idx) => {
                  const changeNum = Number(item.change);
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {item.horseName}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {item.user} · {formatAuditTime(item.timestamp, today)}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {isPositive ? (
                          <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] tabular-nums">
                            +{changeNum}
                          </span>
                        ) : isNegative ? (
                          <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] tabular-nums">
                            {changeNum}
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0] tabular-nums">
                            0
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-4 mt-2 border-t border-[#EEF2F6]">
              <Link
                href="/audit"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline"
              >
                <span>View audit trail</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedPage>
      <AppShell>
        <Suspense
          fallback={
            <div className="p-8 text-center text-slate-400 text-xs">
              Loading Dashboard...
            </div>
          }
        >
          <DashboardContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
