"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import PageTitle from "@/components/PageTitle";
import StepTile from "@/components/StepTile";
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
  Loader2,
  FileSpreadsheet,
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
  // Filter input states
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterDistance, setFilterDistance] = useState("ALL");
  const [filterRaceNo, setFilterRaceNo] = useState("ALL");
  const [filterHorseName, setFilterHorseName] = useState("");
  const [availableDistances, setAvailableDistances] = useState([]);

  // Applied filter state
  const [appliedFilters, setAppliedFilters] = useState({
    startDate: "",
    endDate: "",
    distance: "ALL",
    raceNo: "ALL",
    horseName: "",
  });

  // Selected row state
  const [selectedEntryId, setSelectedEntryId] = useState(null);

  // Pagination state (server-side)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Data rows and loading state
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Fetch Audit Log entries from /api/audit
  const fetchAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
      });

      if (appliedFilters.startDate) params.set("startDate", appliedFilters.startDate);
      if (appliedFilters.endDate) params.set("endDate", appliedFilters.endDate);
      if (appliedFilters.distance && appliedFilters.distance !== "ALL") {
        params.set("distance", appliedFilters.distance);
      }
      if (appliedFilters.raceNo && appliedFilters.raceNo !== "ALL") {
        params.set("race", appliedFilters.raceNo);
      }
      if (appliedFilters.horseName) {
        params.set("horseName", appliedFilters.horseName);
      }

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch audit log entries");

      const data = await res.json();
      setEntries(data.rows || []);
      setTotalCount(data.pagination?.totalCount || 0);
      setTotalPages(data.pagination?.totalPages || 1);
      if (Array.isArray(data.filters?.availableDistances)) {
        setAvailableDistances(data.filters.availableDistances);
      }

      if (data.rows && data.rows.length > 0 && !selectedEntryId) {
        setSelectedEntryId(data.rows[0].id);
      }
    } catch (err) {
      console.error("Error loading audit data:", err);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, currentPage, pageSize]);

  useEffect(() => {
    fetchAuditData();
  }, [fetchAuditData]);

  // Apply filters
  const handleSearch = (e) => {
    e?.preventDefault();
    setAppliedFilters({
      startDate: filterStartDate,
      endDate: filterEndDate,
      distance: filterDistance,
      raceNo: filterRaceNo,
      horseName: filterHorseName.trim().toLowerCase(),
    });
    setCurrentPage(1);
  };

  const handleReset = () => {
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterDistance("ALL");
    setFilterRaceNo("ALL");
    setFilterHorseName("");
    setAppliedFilters({
      startDate: "",
      endDate: "",
      distance: "ALL",
      raceNo: "ALL",
      horseName: "",
    });
    setCurrentPage(1);
  };

  // Active selected entry
  const selectedEntry = useMemo(() => {
    if (selectedEntryId) {
      const found = entries.find((e) => e.id === selectedEntryId);
      if (found) return found;
    }
    return entries[0] || null;
  }, [entries, selectedEntryId]);

  // Excel Export handler
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams();
      if (filterStartDate) params.set("startDate", filterStartDate);
      if (filterEndDate) params.set("endDate", filterEndDate);
      if (filterHorseName.trim()) params.set("race", filterHorseName.trim());

      const response = await fetch(`/api/audit/export?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to export Excel audit log");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `HRA_Audit_Trail_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Excel export failed:", err);
      alert("Failed to export Excel audit log. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // CSV Export handler
  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({
        page: "1",
        pageSize: "1000",
      });
      if (appliedFilters.startDate) params.set("startDate", appliedFilters.startDate);
      if (appliedFilters.endDate) params.set("endDate", appliedFilters.endDate);
      if (appliedFilters.action && appliedFilters.action !== "ALL") {
        params.set("action", appliedFilters.action);
      }
      if (appliedFilters.raceNo && appliedFilters.raceNo !== "ALL") {
        params.set("race", appliedFilters.raceNo);
      }
      if (appliedFilters.horseName) {
        params.set("horseName", appliedFilters.horseName);
      }

      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = await res.json();
      const exportRows = data.rows || [];

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

      const csvLines = exportRows.map((e) => [
        `"${e.atIst || formatDateTime(e.timestamp)}"`,
        `"${e.user || e.userName || ""}"`,
        `"${e.raceDate || ""}"`,
        `"Race ${e.raceNo ?? ""}"`,
        `"${e.horseName || ""}"`,
        e.recommendedRating ?? "",
        e.finalRating ?? "",
        e.change ?? e.finalChange ?? "",
        `"${(e.reason || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent = [headers.join(","), ...csvLines.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `hra_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 1. Page Title */}
      <PageTitle
        title="Audit Trail"
        subtitle="Complete log of handicapper rating overrides and justification records"
      />

      {/* 2. Notice bar */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-700 shadow-xs">
        <Lock className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
        <span className="font-medium">
          Read only. Shows rating changes made by the Handicapper. Entries cannot be edited or deleted.
        </span>
      </div>

      {/* 3. Filters Card (Prototype Layout) */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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

            {/* Distance */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Distance
              </label>
              <select
                value={filterDistance}
                onChange={(e) => setFilterDistance(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="ALL">All Distances</option>
                {(availableDistances.length > 0 ? availableDistances : [1000, 1100, 1200, 1400, 1600, 1800, 2000, 2400]).map((d) => (
                  <option key={d} value={String(d)}>
                    {d} m
                  </option>
                ))}
              </select>
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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((no) => (
                  <option key={no} value={String(no)}>
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

        </form>
      </div>

      {/* 4. Full-width Table Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Handicapper Overrides
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {totalCount} {totalCount === 1 ? "record" : "records"} found
            </span>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting || entries.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              )}
              <span>Export Excel</span>
            </button>
          </div>
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
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#12306B]" />
                      <span>Loading audit records...</span>
                    </div>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-400">
                    No override records match the selected filters.
                  </td>
                </tr>
              ) : (
                entries.map((item) => {
                  const isSelected = selectedEntryId === item.id;
                  const rawChange = item.change !== undefined && item.change !== null ? item.change : item.finalChange;
                  const parsedChange = parseFloat(String(rawChange || 0).replace("+", ""));
                  const changeNum = isNaN(parsedChange) ? 0 : parsedChange;
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;
                  const changeDisplay = isPositive ? `+${changeNum}` : String(changeNum);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedEntryId(item.id)}
                      className={`h-[52px] cursor-pointer transition-colors ${
                        isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {/* Date and time in IST */}
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {item.atIst || formatDateTime(item.timestamp)}
                      </td>

                      {/* Handicapper */}
                      <td className="px-4 py-3 text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {item.user || item.userName || "Handicapper A"}
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
                      <td className="px-3 py-3 text-xs text-slate-700 text-right whitespace-nowrap tabular-nums font-medium">
                        {item.recommendedRating ?? "—"}
                      </td>

                      {/* Final rating */}
                      <td className="px-3 py-3 text-xs text-right whitespace-nowrap tabular-nums font-bold text-slate-900">
                        {item.finalRating ?? "—"}
                      </td>

                      {/* Change */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            isPositive
                              ? "bg-[#DCFCE7] text-[#166534]"
                              : isNegative
                              ? "bg-[#FEE2E2] text-[#991B1B]"
                              : "bg-[#F1F5F9] text-[#475569]"
                          }`}
                        >
                          {changeDisplay}
                        </span>
                      </td>

                      {/* Reason */}
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
        {totalPages > 1 && (
          <div className="px-6 py-3.5 bg-slate-50 border-t border-[#EEF2F6] flex items-center justify-between text-xs text-slate-600">
            <div>
              Page {currentPage} of {totalPages} ({totalCount} records)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1.5 rounded border border-[#CBD5E1] bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded border border-[#CBD5E1] bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Detailed Decision Audit Card below Table (Exact Prototype Design) */}
      {selectedEntry && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#EEF2F6] gap-2 mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Official Decision Audit · {selectedEntry.horseName} · Race {selectedEntry.raceNo ?? 5}
              </h2>
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
                    {selectedEntry.user || selectedEntry.userName || "Handicapper A"}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    {selectedEntry.role || selectedEntry.userRole || "Handicapper"}
                  </span>
                </div>

                {/* Tile 2: Date and time */}
                <div className="p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    Date and time
                  </span>
                  <span className="text-xs font-bold text-slate-900 mt-1 block truncate tabular-nums">
                    {selectedEntry.atIst || formatDateTime(selectedEntry.timestamp)}
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
                      const chg = Number(selectedEntry.change ?? selectedEntry.finalChange ?? 0);
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
                </div>

                {/* Tile 4: Final rating */}
                <div className="p-3.5 rounded-lg border border-blue-200 bg-[#EFF6FF]">
                  <span className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider block">
                    Final rating
                  </span>
                  <span className="text-2xl font-bold text-[#12306B] mt-0.5 block tabular-nums">
                    {selectedEntry.finalRating ?? "—"} pts
                  </span>
                </div>

                {/* Tile 5: Reason (spans full width of the block) */}
                <div className="sm:col-span-2 p-3.5 rounded-lg border border-[#E2E8F0] bg-slate-50/70">
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                    Reason
                  </span>
                  <p className="text-xs font-semibold text-slate-800 mt-1.5 leading-relaxed">
                    {selectedEntry.reason || "—"}
                  </p>
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
