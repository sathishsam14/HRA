"use client";

import React, { Suspense, useState, useMemo } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import Pill from "@/components/Pill";
import { useData } from "@/lib/DataContext";
import {
  Search,
  RotateCcw,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
  Info,
  CheckCircle2,
} from "lucide-react";

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

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

const COLUMN_HEADERS = [
  "Venue",
  "Race date",
  "Race season",
  "Race type",
  "Race category",
  "Race no",
  "Card no",
  "Distance",
  "Current rating",
  "Horse name",
  "Horse weight",
  "Shoes",
  "Weight declare",
  "Jockey",
  "Weight carried",
  "Placing",
  "Timing",
  "Verdict",
  "Trainer",
  "Penetrometer reading",
  "Railing position",
  "Starter report observations",
  "Veterinary report observations",
  "Incident report observations",
  "Recommended rating",
  "Override",
  "Final rating change",
  "Final rating",
  "Reason explanation",
];

function MisContent() {
  const { horses, races } = useData();

  if (!horses || horses.length === 0) {
    console.log("MIS data empty:", { horses, races });
  }

  // Extract unique filter values from data
  const venueOptions = useMemo(() => {
    const set = new Set(races.map((r) => r.venue).filter(Boolean));
    return Array.from(set);
  }, [races]);

  const seasonOptions = useMemo(() => {
    const set = new Set(races.map((r) => r.season).filter(Boolean));
    return Array.from(set);
  }, [races]);

  const typeOptions = useMemo(() => {
    const set = new Set(races.map((r) => r.type).filter(Boolean));
    return Array.from(set);
  }, [races]);

  const categoryOptions = useMemo(() => {
    const set = new Set(races.map((r) => r.category).filter(Boolean));
    return Array.from(set);
  }, [races]);

  const dateOptions = useMemo(() => {
    const set = new Set(races.map((r) => r.date).filter(Boolean));
    return Array.from(set).sort().reverse();
  }, [races]);

  // Filter form state (applied on "Search" button click)
  const [filterVenue, setFilterVenue] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterSeason, setFilterSeason] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({
    venue: "",
    date: "",
    season: "",
    type: "",
    category: "",
  });

  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const handleSearch = (e) => {
    e?.preventDefault();
    setAppliedFilters({
      venue: filterVenue,
      date: filterDate,
      season: filterSeason,
      type: filterType,
      category: filterCategory,
    });
    setCurrentPage(1);
  };

  const handleReset = (e) => {
    e?.preventDefault();
    setFilterVenue("");
    setFilterDate("");
    setFilterSeason("");
    setFilterType("");
    setFilterCategory("");
    setAppliedFilters({
      venue: "",
      date: "",
      season: "",
      type: "",
      category: "",
    });
    setCurrentPage(1);
  };

  // Filter rows
  const filteredRows = useMemo(() => {
    return horses.filter((h) => {
      if (appliedFilters.venue && h.venue !== appliedFilters.venue) return false;
      if (appliedFilters.date && h.date !== appliedFilters.date) return false;
      if (appliedFilters.season && h.season !== appliedFilters.season) return false;
      if (appliedFilters.type && h.type !== appliedFilters.type) return false;
      if (appliedFilters.category && h.category !== appliedFilters.category) return false;
      return true;
    });
  }, [horses, appliedFilters]);

  // Four stat cards computed from filtered rows
  const totalExceptions = useMemo(() => {
    return filteredRows.filter(
      (h) => h.exception && h.exception !== "None" && h.exception !== "-"
    ).length;
  }, [filteredRows]);

  const totalRecommendations = filteredRows.length;

  const totalOverrides = useMemo(() => {
    return filteredRows.filter((h) => h.override).length;
  }, [filteredRows]);

  const totalFinalDecisions = filteredRows.length;

  // Pagination calculations
  const totalPages = Math.ceil(filteredRows.length / rowsPerPage) || 1;
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + rowsPerPage);

  // Selected horse for "Reason explanation" card
  const selectedHorse = useMemo(() => {
    if (selectedHorseId) {
      const found = filteredRows.find((h) => h.id === selectedHorseId);
      if (found) return found;
    }
    return paginatedRows[0] || null;
  }, [filteredRows, selectedHorseId, paginatedRows]);

  // Export CSV handler
  const handleExportCSV = () => {
    const csvRows = [];
    csvRows.push(COLUMN_HEADERS.join(","));

    filteredRows.forEach((h) => {
      const values = [
        h.venue || "BNG",
        h.date || "2026-11-07",
        h.season || "2026-27",
        h.type || "Handicap",
        h.category || "60-85",
        h.raceNo ?? 5,
        h.cardNo ?? 2,
        h.distance ? `${h.distance} m` : "",
        h.currentRating ?? "",
        `"${(h.horseName || "").replace(/"/g, '""')}"`,
        h.horseWeight ?? "",
        `"${(h.shoes || "").replace(/"/g, '""')}"`,
        h.weightDeclare ?? "",
        `"${(h.jockey || "").replace(/"/g, '""')}"`,
        h.weightCarried ?? "",
        h.placing ?? "",
        h.timing ?? "",
        `"${(h.verdict || "").replace(/"/g, '""')}"`,
        `"${(h.trainer || "").replace(/"/g, '""')}"`,
        h.penetrometer ?? "",
        `"${(h.railing || "").replace(/"/g, '""')}"`,
        `"${(h.starterObs || "-").replace(/"/g, '""')}"`,
        `"${(h.vetObs || "-").replace(/"/g, '""')}"`,
        `"${(h.incidentObs || "-").replace(/"/g, '""')}"`,
        h.recommendedRating ?? "",
        h.override ? "Yes" : "No",
        h.finalChange ?? 0,
        h.finalRating ?? "",
        `"${(h.overrideReason || h.reason || "").replace(/"/g, '""')}"`,
      ];
      csvRows.push(values.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `HRA_MIS_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export PDF handler
  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-16 print:p-0 print:space-y-4">
      {/* Title */}
      <div>
        <h1 className="text-[28px] font-semibold text-[#12306B] leading-tight">
          MIS Report
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Historical and operational visibility of rating assessments, exceptions, and handicapper overrides
        </p>
      </div>

      {/* 1. Filter Card with exactly five working filters & exports */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 print:hidden">
        <form onSubmit={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            {/* Filter 1: Venue */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Venue
              </label>
              <select
                value={filterVenue}
                onChange={(e) => setFilterVenue(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Venues</option>
                {venueOptions.map((v) => (
                  <option key={v} value={v}>
                    {v} (Bengaluru Turf Club)
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 2: Race date (range) */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race date (range)
              </label>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Dates</option>
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {formatDisplayDate(d)}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 3: Race season */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race season
              </label>
              <select
                value={filterSeason}
                onChange={(e) => setFilterSeason(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Seasons</option>
                {seasonOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 4: Race type */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race type
              </label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Types</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 5: Race category */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race category
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Actions: Search & Reset */}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 h-10 px-4 bg-white border border-[#CBD5E1] hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span>Search</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                title="Reset filters"
                className="h-10 px-3 bg-white border border-[#CBD5E1] hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>

        {/* Export Buttons */}
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[#EEF2F6]">
          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-rose-600" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* 2. Four Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Total exceptions
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalExceptions}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            System recommendations
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalRecommendations}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Overrides
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalOverrides}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Final decisions
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalFinalDecisions}
          </div>
        </div>
      </div>

      {/* 3. Full-width Table: 29 Columns with Grouped Header Band */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 leading-tight">
              Race-wise MIS
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Comprehensive audit trail of historical runs, reports, handicapper adjustments, and ratified decisions.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-100 border border-slate-200 text-xs font-medium text-slate-600">
            <span className="w-2 h-2 rounded-sm bg-[#12306B]" />
            29 Columns
          </span>
        </div>

        {/* Scrollable Table Container */}
        <div className="overflow-x-auto max-h-[640px] relative">
          <table className="w-full text-left text-xs border-collapse">
            {/* Grouped Header Band */}
            <thead className="sticky top-0 z-20 bg-[#F1F5F9] text-[#475569] font-medium border-b border-[#E2E8F0]">
              <tr className="border-b border-slate-300 text-[11px] font-bold uppercase tracking-wider text-slate-700 bg-slate-200/70">
                <th colSpan={8} className="px-4 py-1.5 border-r border-slate-300">
                  RACE SPECIFICATIONS (COLS 1–8)
                </th>
                <th colSpan={13} className="px-4 py-1.5 border-r border-slate-300">
                  HORSE & PERFORMANCE (COLS 9–21)
                </th>
                <th colSpan={3} className="px-4 py-1.5 border-r border-slate-300">
                  REPORTS & REMARKS (COLS 22–24)
                </th>
                <th colSpan={5} className="px-4 py-1.5">
                  RATING ASSESSMENT (COLS 25–29)
                </th>
              </tr>
              {/* Individual 29 Column Names */}
              <tr className="h-[44px]">
                {/* Fixed Col 1: Venue */}
                <th className="sticky left-0 z-30 bg-[#F1F5F9] px-3.5 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[70px] shadow-[1px_0_0_#CBD5E1]">
                  VENUE
                </th>
                {/* Fixed Col 2: Race date */}
                <th className="sticky left-[70px] z-30 bg-[#F1F5F9] px-3.5 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px] shadow-[2px_0_4px_rgba(0,0,0,0.05)]">
                  RACE DATE
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE SEASON
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE TYPE
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE CATEGORY
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  RACE NO
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  CARD NO
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[80px]">
                  DISTANCE
                </th>
                {/* Horse section (9-21) */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[90px]">
                  CURRENT RATING
                </th>
                <th className="px-4 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap font-bold text-slate-900 min-w-[130px]">
                  HORSE NAME
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[90px]">
                  HORSE WEIGHT
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  SHOES
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[95px]">
                  WEIGHT DECLARE
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
                  JOCKEY
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[95px]">
                  WEIGHT CARRIED
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  PLACING
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[80px]">
                  TIMING
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  VERDICT
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
                  TRAINER
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[100px]">
                  PENETROMETER
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[85px]">
                  RAILING
                </th>
                {/* Reports section (22-24) */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  STARTER OBS
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  VETERINARY OBS
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  INCIDENT OBS
                </th>
                {/* Rating section (25-29) */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[100px]">
                  REC. RATING
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[80px]">
                  OVERRIDE
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[90px]">
                  FINAL CHANGE
                </th>
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[85px]">
                  FINAL RATING
                </th>
                <th className="px-4 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[180px]">
                  REASON EXPLANATION
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={29} className="px-6 py-10 text-center text-xs text-slate-400">
                    No matching records found. Try resetting filters.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((h) => {
                  const isSelected = selectedHorse?.id === h.id;
                  const changeNum = Number(h.finalChange ?? 0);
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;

                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedHorseId(h.id)}
                      className={`h-[48px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#EFF6FF] font-medium"
                          : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {/* Fixed Col 1: Venue */}
                      <td className={`sticky left-0 z-10 px-3.5 py-2 whitespace-nowrap shadow-[1px_0_0_#CBD5E1] ${
                        isSelected ? "bg-[#EFF6FF] text-[#12306B] font-bold" : "bg-white text-slate-800"
                      }`}>
                        {h.venue || "BNG"}
                      </td>
                      {/* Fixed Col 2: Race date */}
                      <td className={`sticky left-[70px] z-10 px-3.5 py-2 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.05)] ${
                        isSelected ? "bg-[#EFF6FF] text-[#12306B] font-medium" : "bg-white text-slate-800"
                      }`}>
                        {formatDisplayDate(h.date)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.season || "2026-27"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.type || "Handicap"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.category || "60-85"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-slate-900 font-medium">
                        {h.raceNo ?? 5}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-slate-700">
                        {h.cardNo ?? 2}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.distance ? `${h.distance} m` : "—"}
                      </td>
                      {/* Horse info (9-21) */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-800">
                        {h.currentRating ?? "—"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap font-semibold text-slate-900">
                        {h.horseName}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.horseWeight ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.shoes || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.weightDeclare ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.jockey || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.weightCarried ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center tabular-nums text-slate-900 font-bold">
                        {h.placing ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700">
                        {h.timing || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.verdict || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.trainer || "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.penetrometer ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.railing || "—"}
                      </td>
                      {/* Reports (22-24) */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.starterObs && h.starterObs !== "-" ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {h.starterObs}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.vetObs && h.vetObs !== "-" ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {h.vetObs}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.incidentObs && h.incidentObs !== "-" ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            {h.incidentObs}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      {/* Rating (25-29) */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-900 font-semibold">
                        {h.recommendedRating ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        {h.override ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                            Yes
                          </span>
                        ) : (
                          <span className="text-slate-400">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-bold">
                        <span
                          className={
                            isPositive
                              ? "text-[#166534]"
                              : isNegative
                              ? "text-[#991B1B]"
                              : "text-[#64748B]"
                          }
                        >
                          {isPositive ? `+${changeNum}` : changeNum}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-900 font-bold">
                        {h.finalRating ?? "—"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-600 text-xs max-w-xs truncate">
                        {h.overrideReason || h.reason || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        <div className="px-6 py-4 bg-white border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            Showing <strong>{filteredRows.length > 0 ? startIndex + 1 : 0}</strong> to{" "}
            <strong>{Math.min(startIndex + rowsPerPage, filteredRows.length)}</strong> of{" "}
            <strong>{filteredRows.length}</strong> entries{" "}
            {filteredRows.length < horses.length && `(filtered from ${horses.length} total records)`}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-8 px-2 bg-white border border-[#CBD5E1] rounded text-xs text-slate-800 focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded border border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .slice(0, 5)
                .map((pageNo) => (
                  <button
                    key={pageNo}
                    type="button"
                    onClick={() => setCurrentPage(pageNo)}
                    className={`w-7 h-7 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      currentPage === pageNo
                        ? "bg-[#12306B] text-white"
                        : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {pageNo}
                  </button>
                ))}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded border border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. "Reason explanation" Card for Selected Horse */}
      {selectedHorse && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#EEF2F6]">
            <h2 className="text-base font-semibold text-slate-900">
              Reason explanation · {selectedHorse.horseName} · Race {selectedHorse.raceNo ?? 5}
            </h2>
            {selectedHorse.override ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                Overridden by Handicapper
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#166534]" />
                System Recommendation Verified
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-5">
            {/* Left box: Automated Audit Analysis */}
            <div className="lg:col-span-5 p-5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between space-y-4">
              <div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500 block mb-2">
                  Automated Audit Analysis
                </span>
                <p className="text-sm text-slate-800 leading-relaxed font-normal">
                  {selectedHorse.override
                    ? `${selectedHorse.horseName} finished ${selectedHorse.placing}${getOrdinal(selectedHorse.placing)} in a ${selectedHorse.runners || 9}-horse ${selectedHorse.type || "Handicap"} race. An expert override was submitted by the handicapper: "${selectedHorse.overrideReason || selectedHorse.reason}".`
                    : `${selectedHorse.horseName} finished ${selectedHorse.placing}${getOrdinal(selectedHorse.placing)} in a ${selectedHorse.runners || 9}-horse ${selectedHorse.type || "Handicap"} race. ${selectedHorse.trace?.referencePosition || "4th"} is the reference position, so the rating ${selectedHorse.finalChange === 0 ? "does not change" : selectedHorse.finalChange > 0 ? "increases by " + selectedHorse.finalChange : "decreases by " + Math.abs(selectedHorse.finalChange)}.`}
                </p>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-600">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span>
                  {selectedHorse.exception && selectedHorse.exception !== "None" && selectedHorse.exception !== "-"
                    ? `Exception remarked: ${selectedHorse.exception}. Protected against rating decrease.`
                    : "No starter, veterinary, or incident remark recorded for this runner."}
                </span>
              </div>
            </div>

            {/* Right box: Trace Details & Summary */}
            <div className="lg:col-span-7 divide-y divide-[#EEF2F6] text-xs">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Race classification</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.classification || selectedHorse.type || "Handicap"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Eligibility</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.eligibility || `${selectedHorse.previousRuns || 3} runs, met`}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Reference position</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.referencePosition || "4th (9 runners)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Weight adjustment</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.weightAdjustment || "0 kg, 0 points"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Coefficient calculation</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.coefficient || "Not applicable at reference"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Exception applied</span>
                <span className="font-semibold text-slate-900">
                  {selectedHorse.trace?.exceptionApplied || selectedHorse.exception || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Recommended rating</span>
                <span className="font-bold text-[#12306B]">
                  {selectedHorse.recommendedRating ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Override</span>
                <span className="font-bold text-slate-900">
                  {selectedHorse.override ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 bg-slate-50/50 px-2 rounded">
                <span className="text-slate-700 font-bold">Final rating</span>
                <span className="font-bold text-base text-[#12306B]">
                  {selectedHorse.finalRating ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MisPage() {
  return (
    <ProtectedPage>
      <AppShell>
        <Suspense
          fallback={
            <div className="p-8 text-center text-slate-400 text-xs">
              Loading MIS Report...
            </div>
          }
        >
          <MisContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
