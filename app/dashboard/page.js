"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import { ArrowRight, Upload, FileText, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

function DashboardContent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Dashboard data load error:", err);
        setLoading(false);
      });
  }, []);

  const stats = data?.stats || {
    racesAwaitingReview: 0,
    racesReviewed: 0,
    horsesNeedingHandicapper: 0,
    overridesThisSeason: 0,
  };

  const uploadedFiles = data?.lastUploadedFiles || [];
  const waitingRaces = data?.races || [];
  const recentOverrides = data?.recentOverrides || [];

  return (
    <div className="space-y-6">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Races awaiting review */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Races awaiting review
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {loading ? "…" : stats.racesAwaitingReview}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Open for handicapper assessment
          </div>
        </div>

        {/* Card 2: Races reviewed */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Races reviewed
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {loading ? "…" : stats.racesReviewed}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Finalized & locked (read-only)
          </div>
        </div>

        {/* Card 3: Horses needing Handicapper */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Horses needing Handicapper
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {loading ? "…" : stats.horsesNeedingHandicapper}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            Special discretion required
          </div>
        </div>

        {/* Card 4: Overrides this season */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Overrides this season
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {loading ? "…" : stats.overridesThisSeason}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
            Handicapper adjustments applied
          </div>
        </div>
      </div>

      {/* Main Grid: Left (Races waiting for review) & Right (Recent Overrides & Last 5 Files) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Races waiting for review table */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between border-b border-[#E2E8F0]">
            <h2 className="text-base font-semibold text-slate-900">
              Races waiting for review
            </h2>
            <div className="flex items-center gap-3">
              <Link
                href="/rating-engine"
                className="text-xs font-medium text-[#2563EB] hover:underline"
              >
                View in Engine →
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569]">RACE</th>
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569]">DATE</th>
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569]">CATEGORY</th>
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569]">DISTANCE</th>
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569] text-center">RUNNERS</th>
                  <th className="px-5 py-3 font-semibold uppercase tracking-wider text-[#475569] text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6]">
                {waitingRaces.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      {loading ? "Loading races..." : "No open races awaiting review"}
                    </td>
                  </tr>
                ) : (
                  waitingRaces.map((race) => (
                    <tr key={race.id} className="h-[48px] hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-5 py-3 font-bold text-slate-900">
                        {race.venue} Race {race.raceNo}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{race.raceDateFormatted}</td>
                      <td className="px-5 py-3 text-slate-700 font-medium">{race.category}</td>
                      <td className="px-5 py-3 text-slate-600">{race.distance} m</td>
                      <td className="px-5 py-3 text-slate-700 text-center font-semibold">{race.runners}</td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/rating-engine?race=${race.id}`}
                          className="text-[#2563EB] hover:underline font-semibold"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (5 cols): Recent Overrides & Last 5 Uploaded Files */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Recent Overrides */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Recent Overrides
              </h2>
              <Link href="/audit" className="text-xs text-[#2563EB] hover:underline font-semibold">
                Full Audit →
              </Link>
            </div>

            <div className="divide-y divide-slate-100 text-xs mt-2">
              {recentOverrides.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  {loading ? "Loading overrides..." : "No overrides recorded yet"}
                </div>
              ) : (
                recentOverrides.map((item) => (
                  <div key={item.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{item.horse}</span>
                      <span className="font-mono text-xs font-bold text-amber-700">
                        Final: {item.finalRating} ({item.finalChange > 0 ? `+${item.finalChange}` : item.finalChange})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={item.reason}>
                      {item.reason}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card 2: Last 5 Uploaded Files (Read-Only list, no upload buttons/inputs) */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Last 5 Uploaded Files
              </h2>
              <span className="text-xs text-slate-400 font-medium">
                System Ingestion
              </span>
            </div>

            <div className="divide-y divide-slate-100 text-xs mt-2">
              {uploadedFiles.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  {loading ? "Loading files..." : "No uploaded files found"}
                </div>
              ) : (
                uploadedFiles.map((file) => (
                  <div key={file.id} className="py-2.5 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="font-semibold text-slate-900 truncate" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 ml-5">
                        {file.sizeKb} KB · {new Date(file.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {file.fileType}
                      </div>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] flex-shrink-0">
                      {file.status === "PROCESSED" ? "Processed" : file.status}
                    </span>
                  </div>
                ))
              )}
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
        <Suspense fallback={<div className="p-8 text-xs text-slate-400">Loading Dashboard...</div>}>
          <DashboardContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
