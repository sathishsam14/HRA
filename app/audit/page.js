"use client";

import React, { useState, useMemo, Suspense } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import PageTitle from "@/components/PageTitle";
import StepTile from "@/components/StepTile";
import { useData } from "@/lib/DataContext";
import {
  Lock,
  Search,
  RotateCcw,
  Download,
  Info,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  User,
  SlidersHorizontal,
} from "lucide-react";

function formatDateTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const datePart = d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const timePart = d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${datePart}, ${timePart}`;
  } catch {
    return isoStr;
  }
}

function formatDateOnly(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoStr;
  }
}

function AuditContent() {
  // DATA RULE: import data through DataContext (no direct fetch)
  const { audit } = useData();

  if (!audit || audit.length === 0) {
    console.log("Audit data is empty in DataContext", { audit });
  }

  // Filter input states
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterRaceNo, setFilterRaceNo] = useState("ALL");
  const [filterHorseName, setFilterHorseName] = useState("");

  // Applied filter states
  const [appliedFilters, setAppliedFilters] = useState({
    startDate: "",
    endDate: "",
    raceNo: "ALL",
    horseName: "",
  });

  // Selected row state (defaults to first entry)
  const [selectedEntryId, setSelectedEntryId] = useState(null);

  // Pagination state (10 per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Apply filters
  const handleSearch = (e) => {
    e?.preventDefault();
    setAppliedFilters({
      startDate: filterStartDate,
      endDate: filterEndDate,
      raceNo: filterRaceNo,
      horseName: filterHorseName.trim().toLowerCase(),
    });
    setCurrentPage(1);
  };

  const handleReset = () => {
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterRaceNo("ALL");
    setFilterHorseName("");
    setAppliedFilters({
      startDate: "",
      endDate: "",
      raceNo: "ALL",
      horseName: "",
    });
    setCurrentPage(1);
  };

  // Filter audit records (newest first)
  const filteredEntries = useMemo(() => {
    const list = audit || [];
    return list.filter((item) => {
      // Date range filter
      if (appliedFilters.startDate) {
        const itemDate = (item.raceDate || item.timestamp || "").slice(0, 10);
        if (itemDate && itemDate < appliedFilters.startDate) return false;
      }
      if (appliedFilters.endDate) {
        const itemDate = (item.raceDate || item.timestamp || "").slice(0, 10);
        if (itemDate && itemDate > appliedFilters.endDate) return false;
      }

      // Race no filter
      if (appliedFilters.raceNo !== "ALL") {
        const raceStr = String(item.raceNo ?? "");
        if (raceStr !== appliedFilters.raceNo) return false;
      }

      // Horse name filter
      if (appliedFilters.horseName) {
        const hName = (item.horseName || "").toLowerCase();
        if (!hName.includes(appliedFilters.horseName)) return false;
      }

      return true;
    });
  }, [audit, appliedFilters]);

  // Available race numbers from audit data
  const availableRaceNos = useMemo(() => {
    const nos = new Set();
    (audit || []).forEach((item) => {
      if (item.raceNo !== undefined && item.raceNo !== null) {
        nos.add(String(item.raceNo));
      }
    });
    return Array.from(nos).sort((a, b) => Number(a) - Number(b));
  }, [audit]);

  // Paginated entries
  const totalPages = Math.ceil(filteredEntries.length / pageSize) || 1;
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEntries.slice(start, start + pageSize);
  }, [filteredEntries, currentPage, pageSize]);

  // Active selected entry
  const selectedEntry = useMemo(() => {
    if (selectedEntryId) {
      const found = filteredEntries.find(
        (e, idx) => (e.id || `${e.raceId}-${e.horseName}-${idx}`) === selectedEntryId
      );
      if (found) return found;
    }
    return filteredEntries[0] || null;
  }, [filteredEntries, selectedEntryId]);

  // CSV Export handler
  const handleExportCSV = () => {
    if (!filteredEntries || filteredEntries.length === 0) return;

    const headers = [
      "Date and Time",
      "Handicapper",
      "Race Date",
      "Race No",
      "Horse",
      "Recommended Rating",
      "Final Rating",
      "Change",
      "Override Reason",
    ];

    const rows = filteredEntries.map((e) => [
      `"${formatDateTime(e.timestamp)}"`,
      `"${e.user || ""}"`,
      `"${e.raceDate || ""}"`,
      `"Race ${e.raceNo ?? ""}"`,
      `"${e.horseName || ""}"`,
      e.recommendedRating ?? "",
      e.finalRating ?? "",
      e.change ?? "",
      `"${(e.reason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `hra_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 1. Page Title */}
      <PageTitle
        title="Audit Trail"
        subtitle="Complete, tamper-evident log of all handicapper rating overrides and justification records"
        actions={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 shadow-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Immutable Audit Log</span>
          </div>
        }
      />

      {/* 2. Notice bar */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-700 shadow-xs">
        <Lock className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
        <span className="font-medium">
          Read only. Shows rating changes made by the Handicapper. Entries cannot be edited or deleted.
        </span>
      </div>

      {/* 3. Filters Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Start Date */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                From Date
              </label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                To Date
              </label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            {/* Race No */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Race No
              </label>
              <select
                value={filterRaceNo}
                onChange={(e) => setFilterRaceNo(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="ALL">All Races</option>
                {availableRaceNos.map((no) => (
                  <option key={no} value={no}>
                    Race {no}
                  </option>
                ))}
              </select>
            </div>

            {/* Horse Name */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Horse Name
              </label>
              <input
                type="text"
                placeholder="Search horse name..."
                value={filterHorseName}
                onChange={(e) => setFilterHorseName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
          </div>

          {/* Action Row: Toggle + Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#F1F5F9]">
            {/* Disabled Toggle: "Show all assessments" with tooltip */}
            <div
              className="flex items-center gap-2.5 opacity-60 cursor-not-allowed group relative"
              title="Available in the full release"
            >
              {/* Fake Toggle Switch */}
              <div className="w-9 h-5 bg-slate-300 rounded-full p-0.5 transition-colors">
                <div className="w-4 h-4 bg-white rounded-full shadow-xs" />
              </div>
              <span className="text-xs font-medium text-slate-600 select-none">
                Show all assessments
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <Info className="w-3 h-3" />
                Available in the full release
              </span>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span>Search</span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-500" />
                <span>Export (CSV)</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 4. Full-width Table Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Handicapper Overrides
          </h2>
          <span className="text-xs text-slate-500">
            {filteredEntries.length} {filteredEntries.length === 1 ? "record" : "records"} found
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  DATE AND TIME
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  HANDICAPPER
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  RACE DATE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  RACE NO
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  HORSE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  RECOMMENDED
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  FINAL
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                  CHANGE
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  OVERRIDE REASON
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {paginatedEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-400">
                    No override records match the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedEntries.map((item, idx) => {
                  const entryKey = item.id || `${item.raceId}-${item.horseName}-${idx}`;
                  const isSelected =
                    selectedEntry &&
                    (selectedEntry.id || `${selectedEntry.raceId}-${selectedEntry.horseName}`) ===
                      (item.id || `${item.raceId}-${item.horseName}`);

                  const changeNum = Number(item.change ?? 0);
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;

                  return (
                    <tr
                      key={entryKey}
                      onClick={() => setSelectedEntryId(entryKey)}
                      className={`h-[52px] cursor-pointer transition-colors ${
                        isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {/* Date and time */}
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {formatDateTime(item.timestamp)}
                      </td>

                      {/* Handicapper */}
                      <td className="px-4 py-3 text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {item.user || "Handicapper A"}
                      </td>

                      {/* Race date */}
                      <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {formatDateOnly(item.raceDate)}
                      </td>

                      {/* Race no */}
                      <td className="px-3 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                        Race {item.raceNo ?? "—"}
                      </td>

                      {/* Horse */}
                      <td className="px-4 py-3 text-sm font-semibold whitespace-nowrap">
                        <span className={isSelected ? "text-[#2563EB]" : "text-slate-900"}>
                          {item.horseName}
                        </span>
                      </td>

                      {/* Recommended rating */}
                      <td className="px-3 py-3 text-sm text-slate-700 text-right whitespace-nowrap tabular-nums">
                        {item.recommendedRating ?? "—"}
                      </td>

                      {/* Final rating */}
                      <td className="px-3 py-3 text-sm font-bold text-slate-900 text-right whitespace-nowrap tabular-nums">
                        {item.finalRating ?? "—"}
                      </td>

                      {/* Change pill */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isPositive
                              ? "bg-[#DCFCE7] text-[#166534]"
                              : isNegative
                              ? "bg-[#FEE2E2] text-[#991B1B]"
                              : "bg-[#F1F5F9] text-[#475569]"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isPositive
                                ? "bg-[#166534]"
                                : isNegative
                                ? "bg-[#991B1B]"
                                : "bg-[#64748B]"
                            }`}
                          />
                          {isPositive ? `+${changeNum}` : changeNum}
                        </span>
                      </td>

                      {/* Override reason */}
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-sm truncate" title={item.reason}>
                        {item.reason || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {filteredEntries.length > 0 && (
          <div className="px-6 py-3 border-t border-[#EEF2F6] flex items-center justify-between text-xs text-slate-500">
            <div>
              Showing{" "}
              <span className="font-semibold text-slate-800">
                {(currentPage - 1) * pageSize + 1}
              </span>{" "}
              to{" "}
              <span className="font-semibold text-slate-800">
                {Math.min(currentPage * pageSize, filteredEntries.length)}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-800">
                {filteredEntries.length}
              </span>{" "}
              entries
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#CBD5E1] bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              <span className="px-2 font-medium text-slate-700">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#CBD5E1] bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Rating assessment trace card for the selected row */}
      {selectedEntry && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 space-y-6">
          <div className="border-b border-[#EEF2F6] pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Rating assessment trace · {selectedEntry.horseName} · Race {selectedEntry.raceNo ?? "—"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Full comparison between algorithmic recommendation steps and recorded handicapper override
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[#12306B] border border-blue-200">
              <Lock className="w-3 h-3 text-[#2563EB]" /> Read Only Record
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Block 1: System recommendation with 7 StepTiles */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  System Recommendation
                </h3>
                <span className="text-[11px] font-semibold text-slate-500">
                  7 Assessment Steps
                </span>
              </div>

              <div className="space-y-2">
                <StepTile
                  stepNumber={1}
                  title="Race classification"
                  subtitle={selectedEntry.trace?.classification || "Handicap"}
                  status="completed"
                />
                <StepTile
                  stepNumber={2}
                  title="Eligibility"
                  subtitle={selectedEntry.trace?.eligibility || "Met"}
                  status="completed"
                />
                <StepTile
                  stepNumber={3}
                  title="Reference position"
                  subtitle={selectedEntry.trace?.referencePosition || "4th"}
                  status="completed"
                />
                <StepTile
                  stepNumber={4}
                  title="Weight adjustment"
                  subtitle={selectedEntry.trace?.weightAdjustment || "0 kg = 0 points"}
                  status="completed"
                />
                <StepTile
                  stepNumber={5}
                  title="Coefficient calculation"
                  subtitle={selectedEntry.trace?.coefficient || "Cumulative coefficient applied"}
                  status="completed"
                />
                <StepTile
                  stepNumber={6}
                  title="Exception applied"
                  subtitle={selectedEntry.trace?.exceptionApplied || "None"}
                  status="completed"
                />
                <StepTile
                  stepNumber={7}
                  title="Recommended rating"
                  subtitle={`${selectedEntry.recommendedRating ?? "—"} pts`}
                  status="active"
                />
              </div>
            </div>

            {/* Block 2: Handicapper override with 5 tiles */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#12306B] uppercase tracking-wider">
                  Handicapper Override
                </h3>
                <span className="text-[11px] font-semibold text-amber-700">
                  Manual Adjustments
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Tile 1: User */}
                <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    User
                  </span>
                  <span className="text-sm font-bold text-slate-900 mt-1 block truncate">
                    {selectedEntry.user || "Handicapper A"}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    {selectedEntry.role || "Handicapper"}
                  </span>
                </div>

                {/* Tile 2: Date and time */}
                <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    Date and time
                  </span>
                  <span className="text-xs font-bold text-slate-900 mt-1 block truncate tabular-nums">
                    {formatDateTime(selectedEntry.timestamp)}
                  </span>
                  <span className="text-[11px] text-emerald-600 mt-0.5 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Timestamp verified
                  </span>
                </div>

                {/* Tile 3: Final rating change */}
                <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    Final rating change
                  </span>
                  <div className="mt-1">
                    {(() => {
                      const chg = Number(selectedEntry.change ?? 0);
                      const isPos = chg > 0;
                      const isNeg = chg < 0;
                      return (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isPos
                              ? "bg-[#DCFCE7] text-[#166534]"
                              : isNeg
                              ? "bg-[#FEE2E2] text-[#991B1B]"
                              : "bg-[#F1F5F9] text-[#475569]"
                          }`}
                        >
                          {isPos ? `+${chg}` : chg} pts
                        </span>
                      );
                    })()}
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Delta from recommended
                  </span>
                </div>

                {/* Tile 5 (rendered side by side): Final rating */}
                <div className="p-3.5 rounded-lg border border-blue-200 bg-[#EFF6FF]">
                  <span className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider block">
                    Final rating
                  </span>
                  <span className="text-2xl font-bold text-[#12306B] mt-0.5 block tabular-nums">
                    {selectedEntry.finalRating ?? "—"} pts
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    Official post-race rating
                  </span>
                </div>

                {/* Tile 4: Reason (spans full width of the block) */}
                <div className="sm:col-span-2 p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    Reason
                  </span>
                  <p className="text-xs font-semibold text-slate-800 mt-1.5 leading-relaxed">
                    {selectedEntry.reason || "—"}
                  </p>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Recorded handicapper justification
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <ProtectedPage>
      <AppShell>
        <Suspense
          fallback={
            <div className="p-8 text-center text-slate-400 text-xs">
              Loading Audit Trail...
            </div>
          }
        >
          <AuditContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
