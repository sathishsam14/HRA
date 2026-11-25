"use client";

import React, { Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import {
  Search,
  RotateCcw,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
} from "lucide-react";

function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
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
  const num = Number(n);
  if (isNaN(num)) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = num % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function MisContent() {
  // Filter form state (draft inputs)
  const [filterVenue, setFilterVenue] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterSeason, setFilterSeason] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterHorseName, setFilterHorseName] = useState("");

  // Applied filter state for query
  const [appliedFilters, setAppliedFilters] = useState({
    venue: "",
    raceDate: "",
    season: "",
    raceType: "",
    category: "",
    horseName: "",
  });

  // Filter dropdown options (fetched from API)
  const [filterOptions, setFilterOptions] = useState({
    venues: [],
    dates: [],
    seasons: [],
    types: [],
    categories: [],
    categoriesByType: { Handicap: [], Terms: [] },
  });

  // Dynamically compute categories belonging to the selected race type
  const availableCategories = useMemo(() => {
    if (filterType === "Handicap" && filterOptions.categoriesByType?.Handicap?.length > 0) {
      return filterOptions.categoriesByType.Handicap;
    }
    if (filterType === "Terms" && filterOptions.categoriesByType?.Terms?.length > 0) {
      return filterOptions.categoriesByType.Terms;
    }
    return filterOptions.categories || [];
  }, [filterType, filterOptions]);

  const handleTypeChange = (newType) => {
    setFilterType(newType);
    if (newType === "Handicap") {
      const handicapCats = filterOptions.categoriesByType?.Handicap || [];
      if (filterCategory && handicapCats.length > 0 && !handicapCats.includes(filterCategory)) {
        setFilterCategory("");
      }
    } else if (newType === "Terms") {
      const termsCats = filterOptions.categoriesByType?.Terms || [];
      if (filterCategory && termsCats.length > 0 && !termsCats.includes(filterCategory)) {
        setFilterCategory("");
      }
    }
  };

  // Pagination state (server-side)
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Data rows and loading state
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState(null);

  const paginationScrollRef = useRef(null);

  // Auto-scroll the horizontal pagination track so the active page button remains centered.
  // Using container.scrollTo directly ensures ONLY the pagination track scrolls,
  // preventing ancestor containers, the table card, or the page from shifting.
  useEffect(() => {
    if (paginationScrollRef.current) {
      const container = paginationScrollRef.current;
      const activeBtn = container.querySelector(
        `[data-page="${currentPage}"]`
      );
      if (activeBtn) {
        const scrollTarget =
          activeBtn.offsetLeft -
          container.clientWidth / 2 +
          activeBtn.clientWidth / 2;
        container.scrollTo({
          left: Math.max(0, scrollTarget),
          behavior: "smooth",
        });
      }
    }
  }, [currentPage]);

  // Fetch MIS data with client-side caching (render cache immediately without blocking reload)
  const fetchMisData = useCallback(async (forceRefresh = false) => {
    const params = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(rowsPerPage),
    });

    if (appliedFilters.venue) params.set("venue", appliedFilters.venue);
    if (appliedFilters.raceDate) params.set("raceDate", appliedFilters.raceDate);
    if (appliedFilters.season) params.set("season", appliedFilters.season);
    if (appliedFilters.raceType) params.set("raceType", appliedFilters.raceType);
    if (appliedFilters.category) params.set("category", appliedFilters.category);
    if (appliedFilters.horseName) params.set("horseName", appliedFilters.horseName);

    const cacheKey = `hra_cache_mis_${params.toString()}`;

    // 1. Check client session cache first
    let hasCachedData = false;
    if (!forceRefresh && typeof window !== "undefined") {
      try {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.data && Array.isArray(cached.data.rows)) {
            hasCachedData = true;
            setRows(cached.data.rows);
            setTotalCount(cached.data.pagination?.totalCount || 0);
            setTotalPages(cached.data.pagination?.totalPages || 1);
            if (cached.data.filters) {
              setFilterOptions((prev) => ({
                venues: cached.data.filters.venues || prev.venues,
                dates: cached.data.filters.dates || prev.dates,
                seasons: cached.data.filters.seasons || prev.seasons,
                types: cached.data.filters.types || prev.types,
                categories: cached.data.filters.categories || prev.categories,
                categoriesByType: cached.data.filters.categoriesByType || prev.categoriesByType,
              }));
            }
            setLoading(false);
          }
        }
      } catch (cacheErr) {
        console.warn("MIS session cache read error:", cacheErr);
      }
    }

    // 2. Fetch fresh data from DB (in background if cache hit, or with spinner if cold start / force refresh)
    if (!hasCachedData || forceRefresh) {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/mis?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch MIS records");

      const data = await res.json();

      // Save to sessionStorage cache
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
        } catch (saveErr) {
          console.warn("MIS session cache save error:", saveErr);
        }
      }

      setRows(data.rows || []);
      setTotalCount(data.pagination?.totalCount || 0);
      setTotalPages(data.pagination?.totalPages || 1);

      if (data.filters) {
        setFilterOptions((prev) => ({
          venues: data.filters.venues || prev.venues,
          dates: data.filters.dates || prev.dates,
          seasons: data.filters.seasons || prev.seasons,
          types: data.filters.types || prev.types,
          categories: data.filters.categories || prev.categories,
          categoriesByType: data.filters.categoriesByType || prev.categoriesByType,
        }));
      }
    } catch (err) {
      console.error("Error loading MIS data:", err);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, currentPage, rowsPerPage]);

  useEffect(() => {
    fetchMisData();
  }, [fetchMisData]);

  // Handle Search submit
  const handleSearch = (e) => {
    e?.preventDefault();
    setAppliedFilters({
      venue: filterVenue,
      raceDate: filterDate,
      season: filterSeason,
      raceType: filterType,
      category: filterCategory,
      horseName: filterHorseName.trim(),
    });
    setCurrentPage(1);
  };

  // Handle Reset
  const handleReset = (e) => {
    e?.preventDefault();
    setFilterVenue("");
    setFilterDate("");
    setFilterSeason("");
    setFilterType("");
    setFilterCategory("");
    setFilterHorseName("");
    setAppliedFilters({
      venue: "",
      raceDate: "",
      season: "",
      raceType: "",
      category: "",
      horseName: "",
    });
    setCurrentPage(1);
  };

  // Export Excel (.xlsx) via /api/mis/export
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams();
      if (appliedFilters.venue) params.set("venue", appliedFilters.venue);
      if (appliedFilters.raceDate) params.set("raceDate", appliedFilters.raceDate);
      if (appliedFilters.season) params.set("season", appliedFilters.season);
      if (appliedFilters.raceType) params.set("raceType", appliedFilters.raceType);
      if (appliedFilters.category) params.set("category", appliedFilters.category);
      if (appliedFilters.horseName) params.set("horseName", appliedFilters.horseName);

      const response = await fetch(`/api/mis/export?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to export Excel report");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `HRA_MIS_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export Excel report. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Export PDF (print)
  const handleExportPDF = () => {
    window.print();
  };

  // Stats computed from current data
  const totalExceptions = useMemo(() => {
    return rows.filter(
      (r) =>
        (r.starterReport && r.starterReport !== "—") ||
        (r.veterinaryReport && r.veterinaryReport !== "—") ||
        (r.incidentReport && r.incidentReport !== "—") ||
        r.status === "NEEDS_HANDICAPPER"
    ).length;
  }, [rows]);

  const totalOverrides = useMemo(() => {
    return rows.filter((r) => r.overridden).length;
  }, [rows]);

  // Selected row for detail card
  const selectedRow = useMemo(() => {
    if (selectedRowId) {
      const found = rows.find((r) => r.id === selectedRowId);
      if (found) return found;
    }
    return rows[0] || null;
  }, [rows, selectedRowId]);

  const startIndex = (currentPage - 1) * rowsPerPage;

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

      {/* 1. Filter Card with Venue, Race Date, Season, Type, Category, Horse Name & Export Buttons */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 print:hidden">
        <form onSubmit={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end">
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
                {filterOptions.venues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 2: Race date */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race Date
              </label>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Dates</option>
                {filterOptions.dates.map((d) => (
                  <option key={d} value={d}>
                    {formatDisplayDate(d)}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 3: Race season */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race Season
              </label>
              <select
                value={filterSeason}
                onChange={(e) => setFilterSeason(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Seasons</option>
                {filterOptions.seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 4: Race type */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race Type
              </label>
              <select
                value={filterType}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Types</option>
                {filterOptions.types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 5: Race category (filtered dynamically by selected Race Type) */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Race Category
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">All Categories</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 6: Horse Name */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">
                Horse Name
              </label>
              <input
                type="text"
                placeholder="Search horse name..."
                value={filterHorseName}
                onChange={(e) => setFilterHorseName(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            {/* Actions: Search & Reset */}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 h-10 px-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
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
            onClick={handleExportExcel}
            disabled={exporting || rows.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            )}
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            Total exceptions (on page)
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalExceptions}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Matching records
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalCount}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Overrides (on page)
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalOverrides}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="text-xs font-medium text-slate-500">
            Total entries
          </div>
          <div className="text-3xl font-bold text-slate-900 mt-2">
            {totalCount}
          </div>
        </div>
      </div>

      {/* 3. Full-width Table: 27 Statutory Columns with Grouped Header Band */}
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
            29 Statutory Columns
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
                <th colSpan={14} className="px-4 py-1.5 border-r border-slate-300">
                  HORSE & PERFORMANCE (COLS 9–22)
                </th>
                <th colSpan={3} className="px-4 py-1.5 border-r border-slate-300">
                  REPORTS & REMARKS (COLS 23–25)
                </th>
                <th colSpan={4} className="px-4 py-1.5">
                  RATING ASSESSMENT (COLS 26–29)
                </th>
              </tr>
              {/* Individual 29 Column Names */}
              <tr className="h-[44px]">
                {/* 1. Venue */}
                <th className="sticky left-0 z-30 bg-[#F1F5F9] px-3.5 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[70px] shadow-[1px_0_0_#CBD5E1]">
                  VENUE
                </th>
                {/* 2. Race date */}
                <th className="sticky left-[70px] z-30 bg-[#F1F5F9] px-3.5 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px] shadow-[2px_0_4px_rgba(0,0,0,0.05)]">
                  RACE DATE
                </th>
                {/* 3. Race season */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE SEASON
                </th>
                {/* 4. Race type */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE TYPE
                </th>
                {/* 5. Race category */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  RACE CATEGORY
                </th>
                {/* 6. Race no */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  RACE NO
                </th>
                {/* 7. Card no */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  CARD NO
                </th>
                {/* 8. Distance */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[80px]">
                  DISTANCE
                </th>
                {/* 9. Current rating */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[95px] font-bold text-slate-900">
                  CURRENT RATING
                </th>
                {/* 10. Horse name */}
                <th className="px-4 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap font-bold text-slate-900 min-w-[130px]">
                  HORSE NAME
                </th>
                {/* 11. Horse weight */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[90px]">
                  HORSE WEIGHT
                </th>
                {/* 12. Shoes */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  SHOES
                </th>
                {/* 13. Start Gate */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[80px]">
                  START GATE
                </th>
                {/* 14. Weight declare */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[95px]">
                  WEIGHT DECLARE
                </th>
                {/* 15. Jockey */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
                  JOCKEY
                </th>
                {/* 16. Weight carried */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[95px]">
                  WEIGHT CARRIED
                </th>
                {/* 17. Placing */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[70px]">
                  PLACING
                </th>
                {/* 18. Timing */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[80px]">
                  TIMING
                </th>
                {/* 19. Verdict */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[90px]">
                  VERDICT
                </th>
                {/* 20. Trainer */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[100px]">
                  TRAINER
                </th>
                {/* 21. Penetrometer reading */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[100px]">
                  PENETROMETER
                </th>
                {/* 22. Railing position */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[85px]">
                  RAILING
                </th>
                {/* 23. Starter report observations */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  STARTER OBS
                </th>
                {/* 24. Veterinary report observations */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  VETERINARY OBS
                </th>
                {/* 25. Incidence report observations */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[120px]">
                  INCIDENCE OBS
                </th>
                {/* 26. Rating Status */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[90px]">
                  STATUS
                </th>
                {/* 27. Override */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-center min-w-[85px]">
                  OVERRIDE
                </th>
                {/* 28. Rating Change */}
                <th className="px-3 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap text-right min-w-[90px]">
                  RATING CHANGE
                </th>
                {/* 29. Reason explanation */}
                <th className="px-4 py-2.5 uppercase tracking-wider text-[11px] whitespace-nowrap min-w-[200px]">
                  REASON EXPLANATION
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {loading ? (
                <tr>
                  <td colSpan={29} className="px-6 py-12 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#12306B]" />
                      <span>Loading MIS records from server...</span>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={29} className="px-6 py-12 text-center text-slate-500">
                    <p className="text-sm font-semibold text-slate-700">No current races. Upload a race file.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Once races are reviewed and confirmed in the Rating Engine, their finalized decisions appear here in MIS.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((h) => {
                  const isSelected = selectedRow?.id === h.id;
                  const changeNum = parseFloat(String(h.finalChange).replace("+", ""));
                  const isPositive = !isNaN(changeNum) && changeNum > 0;
                  const isNegative = !isNaN(changeNum) && changeNum < 0;

                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedRowId(h.id)}
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
                        {h.venue}
                      </td>
                      {/* Fixed Col 2: Race date */}
                      <td className={`sticky left-[70px] z-10 px-3.5 py-2 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.05)] ${
                        isSelected ? "bg-[#EFF6FF] text-[#12306B] font-medium" : "bg-white text-slate-800"
                      }`}>
                        {h.raceDateFormatted || h.raceDate}
                      </td>
                      {/* 3. Season */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.raceSeason}
                      </td>
                      {/* 4. Type */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.raceType}
                      </td>
                      {/* 5. Category */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.raceCategory}
                      </td>
                      {/* 6. Race No */}
                      <td className="px-3 py-2 whitespace-nowrap text-center text-slate-900 font-medium">
                        {h.raceNo}
                      </td>
                      {/* 7. Card No */}
                      <td className="px-3 py-2 whitespace-nowrap text-center text-slate-700">
                        {h.cardNo}
                      </td>
                      {/* 8. Distance */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.distance}
                      </td>
                      {/* 9. Current Rating */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-800">
                        {h.currentRating}
                      </td>
                      {/* 10. Horse Name */}
                      <td className="px-4 py-2 whitespace-nowrap font-semibold text-slate-900">
                        {h.horseName}
                      </td>
                      {/* 11. Horse Weight */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.horseWeight}
                      </td>
                      {/* 12. Shoes */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.shoes}
                      </td>
                      {/* 13. Start Gate */}
                      <td className="px-3 py-2 whitespace-nowrap text-center tabular-nums text-slate-700">
                        {h.startGate}
                      </td>
                      {/* 14. Weight Declare */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.weightDeclare}
                      </td>
                      {/* 15. Jockey */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.jockey}
                      </td>
                      {/* 16. Weight Carried */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.weightCarried}
                      </td>
                      {/* 17. Placing */}
                      <td className="px-3 py-2 whitespace-nowrap text-center tabular-nums text-slate-900 font-bold">
                        {h.placing}
                      </td>
                      {/* 18. Timing */}
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-slate-700">
                        {h.timing}
                      </td>
                      {/* 19. Verdict */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.verdict}
                      </td>
                      {/* 20. Trainer */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.trainer}
                      </td>
                      {/* 21. Penetrometer */}
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {h.penetrometer}
                      </td>
                      {/* 22. Railing */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                        {h.railing}
                      </td>
                      {/* 23. Starter Obs */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.starterReport && h.starterReport !== "—" ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {h.starterReport}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* 24. Veterinary Obs */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.veterinaryReport && h.veterinaryReport !== "—" ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {h.veterinaryReport}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* 25. Incident Obs */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                        {h.incidentReport && h.incidentReport !== "—" ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            {h.incidentReport}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* 26. Rating Status */}
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          h.status === "RATED"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : h.status === "UNCHANGED"
                            ? "bg-slate-100 text-slate-700 border-slate-200"
                            : h.status === "NEEDS_HANDICAPPER"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}>
                          {h.status || "—"}
                        </span>
                      </td>
                      {/* 27. Override */}
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        {h.overridden ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                            Yes
                          </span>
                        ) : h.override === "No" ? (
                          <span className="text-slate-400">No</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {/* 28. Rating Change */}
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
                          {h.finalChange}
                        </span>
                      </td>
                      {/* 29. Reason Explanation */}
                      <td className="px-4 py-2 whitespace-nowrap text-slate-600 text-xs max-w-xs truncate" title={h.reasonExplanation}>
                        {h.reasonExplanation || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Server-side Pagination Bar */}
        <div className="px-6 py-4 bg-white border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex-shrink-0">
            Showing <strong>{rows.length > 0 ? startIndex + 1 : 0}</strong> to{" "}
            <strong>{Math.min(startIndex + rows.length, totalCount)}</strong> of{" "}
            <strong>{totalCount}</strong> entries
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-1.5 flex-shrink-0">
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
                <option value={75}>75</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loading}
                className="flex-shrink-0 p-1 rounded border border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Fixed-width horizontal side-scroll track for page numbers */}
              <div
                ref={paginationScrollRef}
                onWheel={(e) => {
                  if (paginationScrollRef.current && e.deltaY !== 0) {
                    paginationScrollRef.current.scrollLeft += e.deltaY;
                  }
                }}
                className="flex items-center gap-1 overflow-x-auto w-[280px] sm:w-[320px] py-1 px-1 scroll-smooth flex-shrink-0"
                style={{ scrollbarWidth: "thin", scrollbarColor: "#CBD5E1 transparent" }}
              >
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNo) => (
                  <button
                    key={pageNo}
                    data-page={pageNo}
                    type="button"
                    onClick={() => setCurrentPage(pageNo)}
                    disabled={loading}
                    className={`flex-shrink-0 min-w-[28px] h-7 px-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                      currentPage === pageNo
                        ? "bg-[#12306B] text-white"
                        : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {pageNo}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loading}
                className="flex-shrink-0 p-1 rounded border border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Reason Explanation & Performance Card for Selected Row */}
      {selectedRow && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#EEF2F6]">
            <h2 className="text-base font-semibold text-slate-900">
              Rating assessment · {selectedRow.horseName} · Race {selectedRow.raceNo}
            </h2>
            {selectedRow.overridden ? (
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
                  {selectedRow.horseName} placed {selectedRow.placing}
                  {getOrdinal(selectedRow.placing)} at {selectedRow.venue} on {selectedRow.raceDateFormatted || selectedRow.raceDate}.
                  Recommended rating: {selectedRow.recommendedRating}, official ratified rating: {selectedRow.finalRating} ({selectedRow.finalChange}).
                </p>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-600">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span>
                  {selectedRow.starterReport !== "—" || selectedRow.veterinaryReport !== "—" || selectedRow.incidentReport !== "—"
                    ? `Observations reported: Starter: ${selectedRow.starterReport}, Vet: ${selectedRow.veterinaryReport}, Incidence: ${selectedRow.incidentReport}.`
                    : "No starter, veterinary, or incident remark recorded for this runner."}
                </span>
              </div>
            </div>

            {/* Right box: Trace Details & Summary */}
            <div className="lg:col-span-7 divide-y divide-[#EEF2F6] text-xs">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Race classification</span>
                <span className="font-semibold text-slate-900">
                  {selectedRow.raceType} ({selectedRow.raceCategory})
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Current rating</span>
                <span className="font-semibold text-slate-900">
                  {selectedRow.currentRating}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Weight carried / declare</span>
                <span className="font-semibold text-slate-900">
                  {selectedRow.weightCarried} / {selectedRow.weightDeclare}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Recommended rating</span>
                <span className="font-bold text-[#12306B]">
                  {selectedRow.recommendedRating}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-slate-500 font-medium">Overridden</span>
                <span className="font-bold text-slate-900">
                  {selectedRow.overridden ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 bg-slate-50/50 px-2 rounded">
                <span className="text-slate-700 font-bold">Final rating</span>
                <span className="font-bold text-base text-[#12306B]">
                  {selectedRow.finalRating}
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
