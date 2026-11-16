"use client";

import React, { Suspense, useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import OverrideDialog from "@/components/OverrideDialog";
import { useAuth } from "@/lib/AuthContext";
import {
  FileText,
  FileSpreadsheet,
  Database,
  History,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Calendar,
  ChevronDown,
  Layers,
  Send,
  SlidersHorizontal,
  RefreshCw,
  Loader2,
  Upload,
} from "lucide-react";

function getOrdinal(n) {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function RatingEngineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRaceParam = searchParams.get("race");

  const { user } = useAuth();
  const isHandicapperOrAdmin = user?.role === "HANDICAPPER" || user?.role === "ADMIN";
  const isViewer = user?.role === "VIEWER";

  // Filter state
  const [venueFilter, setVenueFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [raceTypeFilter, setRaceTypeFilter] = useState("ALL");
  const [raceNoFilter, setRaceNoFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [distanceFilter, setDistanceFilter] = useState("ALL");

  // Server data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterOptions, setFilterOptions] = useState({
    venues: [],
    dates: [],
    raceTypes: [],
    raceNos: [],
    categories: [],
    categoriesByType: { Handicap: [], Terms: [] },
    distances: [],
  });
  const [races, setRaces] = useState([]);
  const [selectedRaceId, setSelectedRaceId] = useState(null);

  // Computed categories based on race type
  const availableCategories = useMemo(() => {
    if (raceTypeFilter === "Handicap" && filterOptions.categoriesByType?.Handicap) {
      return filterOptions.categoriesByType.Handicap;
    }
    if (raceTypeFilter === "Terms" && filterOptions.categoriesByType?.Terms) {
      return filterOptions.categoriesByType.Terms;
    }
    return filterOptions.categories || [];
  }, [raceTypeFilter, filterOptions]);

  const handleRaceTypeChange = (newType) => {
    setRaceTypeFilter(newType);
    if (newType !== "ALL" && filterOptions.categoriesByType) {
      const allowed = filterOptions.categoriesByType[newType] || [];
      if (categoryFilter !== "ALL" && !allowed.includes(categoryFilter)) {
        setCategoryFilter("ALL");
      }
    }
  };

  // Local working decisions (entryId -> { finalChange, finalRating, overridden, overrideReason })
  const [workingDecisions, setWorkingDecisions] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [autoRating, setAutoRating] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [overrideModalHorse, setOverrideModalHorse] = useState(null);
  const [selectedHorseId, setSelectedHorseId] = useState(null);

  // Fetch races with client-side caching (SWR: render cache immediately without blocking reload)
  const loadRaces = async (forceRefresh = false) => {
    const params = new URLSearchParams();
    if (venueFilter !== "ALL") params.set("venue", venueFilter);
    if (dateFilter !== "ALL") params.set("raceDate", dateFilter);
    if (raceTypeFilter !== "ALL") params.set("raceType", raceTypeFilter);
    if (raceNoFilter !== "ALL") params.set("raceNo", raceNoFilter);
    if (categoryFilter !== "ALL") params.set("category", categoryFilter);
    if (distanceFilter !== "ALL") params.set("distance", distanceFilter);

    const cacheKey = `hra_cache_races_${params.toString()}`;

    // 1. Check client session cache first
    let hasCachedData = false;
    if (!forceRefresh && typeof window !== "undefined") {
      try {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.data && Array.isArray(cached.data.races)) {
            hasCachedData = true;
            setFilterOptions(cached.data.filters || {});
            setRaces(cached.data.races);
            setLoading(false);

            if (cached.data.races.length > 0) {
              if (selectedRaceId && cached.data.races.some((r) => r.id === selectedRaceId)) {
                // Keep selected race
              } else if (initialRaceParam) {
                const match = cached.data.races.find(
                  (r) => String(r.id) === initialRaceParam || String(r.raceNo) === initialRaceParam
                );
                setSelectedRaceId(match ? match.id : cached.data.races[0].id);
              } else {
                setSelectedRaceId(cached.data.races[0].id);
              }
            }
          }
        }
      } catch (cacheErr) {
        console.warn("Session cache read error:", cacheErr);
      }
    }

    // 2. Fetch from server (background revalidation if cached; spinner only on cold start or manual refresh)
    try {
      if (!hasCachedData || forceRefresh) {
        setLoading(true);
      }
      setError(null);

      const res = await fetch(`/api/rating-engine/races?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load race data from server");
      }

      const data = await res.json();

      // Update cache
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
        } catch (saveErr) {
          console.warn("Session cache save error:", saveErr);
        }
      }

      setFilterOptions(
        data.filters || {
          venues: [],
          dates: [],
          raceTypes: [],
          raceNos: [],
          categories: [],
          categoriesByType: { Handicap: [], Terms: [] },
          distances: [],
        }
      );
      setRaces(data.races || []);

      // Initialize selected race
      if (data.races && data.races.length > 0) {
        if (selectedRaceId && data.races.some((r) => r.id === selectedRaceId)) {
          // Keep current
        } else if (initialRaceParam) {
          const match = data.races.find(
            (r) =>
              String(r.id) === initialRaceParam ||
              String(r.raceNo) === initialRaceParam
          );
          setSelectedRaceId(match ? match.id : data.races[0].id);
        } else {
          setSelectedRaceId(data.races[0].id);
        }
      } else {
        setSelectedRaceId(null);
      }
    } catch (err) {
      console.error("Error loading races:", err);
      if (!hasCachedData) {
        setError(err.message || "Failed to load races");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRaces();
  }, [venueFilter, dateFilter, raceTypeFilter, raceNoFilter, categoryFilter, distanceFilter]);

  // Handle manual Auto-Rate / Validate action
  const handleAutoRate = async () => {
    try {
      setAutoRating(true);
      const res = await fetch("/api/rating-engine/re-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId: currentRace ? currentRace.id : "ALL",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Auto-rate validation failed");
      }

      // Clear cached data so fresh ratings are loaded
      if (typeof window !== "undefined") {
        Object.keys(sessionStorage).forEach((key) => {
          if (key.startsWith("hra_cache_races_")) {
            sessionStorage.removeItem(key);
          }
        });
      }

      setToastMessage(data.message || "Ratings validated & auto-rated successfully!");
      setTimeout(() => setToastMessage(""), 5000);

      // Force reload fresh from database
      await loadRaces(true);
    } catch (err) {
      console.error("Auto-rate error:", err);
      alert(err.message || "Failed to trigger auto-rating validation");
    } finally {
      setAutoRating(false);
    }
  };

  // Selected race object
  const currentRace = useMemo(() => {
    return races.find((r) => r.id === selectedRaceId) || races[0] || null;
  }, [races, selectedRaceId]);

  // Entries for current race with working overrides merged
  const currentHorses = useMemo(() => {
    if (!currentRace || !currentRace.entries) return [];

    return currentRace.entries.map((entry) => {
      const working = workingDecisions[entry.id];
      const overridden = working ? working.overridden : entry.overridden;
      const finalChange = working ? working.finalChange : entry.finalChange;
      const finalRating = working ? working.finalRating : entry.finalRating;
      const overrideReason = working ? working.overrideReason : entry.overrideReason;

      return {
        ...entry,
        overridden,
        finalChange,
        finalRating,
        overrideReason,
      };
    });
  }, [currentRace, workingDecisions]);

  // Active selected horse for explanation card
  const activeHorse = useMemo(() => {
    if (selectedHorseId) {
      const found = currentHorses.find((h) => h.id === selectedHorseId);
      if (found) return found;
    }
    // Default to 4th place or first
    const fourth = currentHorses.find((h) => h.placing === 4);
    return fourth || currentHorses[0] || null;
  }, [currentHorses, selectedHorseId]);

  // Check if race has any unresolved NEEDS_HANDICAPPER
  const unresolvedNeedsHandicapper = useMemo(() => {
    return currentHorses.filter((h) => {
      if (h.ratingStatus !== "NEEDS_HANDICAPPER") return false;
      const working = workingDecisions[h.id];
      if (
        working &&
        Number.isFinite(working.finalChange) &&
        Number.isFinite(working.finalRating)
      ) {
        return false;
      }
      if (h.overridden && Number.isFinite(h.finalChange)) return false;
      return true;
    });
  }, [currentHorses, workingDecisions]);

  const isRaceReviewed = currentRace?.status === "REVIEWED";

  // Race files state matching the 3 primary files + 3 steward reports (6 cards)
  const raceFiles = useMemo(() => {
    if (!currentRace) return [];
    const hasStarter = currentHorses.some((h) => h.starterRemark);
    const hasVet = currentHorses.some((h) => h.veterinaryRemark);
    const hasIncident = currentHorses.some((h) => h.incidentRemark);

    return [
      {
        name: "Master data",
        fileType: "HISTORY",
        status: "Received",
        detail: "BWM-BSM 22-26-Consolidated.xlsx",
        icon: Database,
      },
      {
        name: "Previous race history",
        fileType: "ACTIVE_HORSE",
        status: "Received",
        detail: "Active Horse Previous perfomance report.xlsx",
        icon: History,
      },
      {
        name: "Coefficient table",
        fileType: "COEFFICIENT",
        status: "Uploaded",
        detail: "Coefficient_Table.xlsx (51 rules)",
        icon: SlidersHorizontal,
      },
      {
        name: "Starter report",
        fileType: "STARTER",
        status: hasStarter ? "Uploaded" : "Not uploaded",
        detail: hasStarter ? `starter_${currentRace.raceNo}.docx` : "Optional",
        icon: FileText,
      },
      {
        name: "Veterinary report",
        fileType: "VETERINARY",
        status: hasVet ? "Uploaded" : "Not uploaded",
        detail: hasVet ? `vet_${currentRace.raceNo}.pdf` : "Optional",
        icon: FileText,
      },
      {
        name: "Incident report",
        fileType: "INCIDENT",
        status: hasIncident ? "Uploaded" : "Not uploaded",
        detail: hasIncident ? `incident_${currentRace.raceNo}.docx` : "Optional",
        icon: AlertTriangle,
      },
    ];
  }, [currentRace, currentHorses]);

  // Handle local override save
  const handleSaveOverride = (overrideData) => {
    if (!overrideModalHorse) return;

    setWorkingDecisions((prev) => ({
      ...prev,
      [overrideModalHorse.id]: {
        entryId: overrideModalHorse.id,
        finalChange: overrideData.finalChange,
        finalRating: overrideData.finalRating,
        overridden: true,
        overrideReason: overrideData.reason,
      },
    }));

    setToastMessage(
      `Override prepared for ${overrideModalHorse.horseName}: Change ${
        overrideData.finalChange > 0
          ? `+${overrideData.finalChange}`
          : overrideData.finalChange
      } (Rating: ${overrideData.finalRating})`
    );
    setTimeout(() => setToastMessage(""), 5000);
    setOverrideModalHorse(null);
  };

  // Submit race review to server
  const handleSubmitRace = async () => {
    if (!currentRace || isRaceReviewed || !isHandicapperOrAdmin) return;

    if (unresolvedNeedsHandicapper.length > 0) {
      alert(
        `Cannot submit race: ${unresolvedNeedsHandicapper.length} horse(s) with NEEDS_HANDICAPPER status must be decided by the Handicapper first.`
      );
      return;
    }

    try {
      setSubmitting(true);

      const decisionsPayload = currentHorses.map((h) => {
        const working = workingDecisions[h.id];
        return {
          entryId: h.id,
          finalChange: working ? working.finalChange : h.finalChange,
          finalRating: working ? working.finalRating : h.finalRating,
          overridden: working ? working.overridden : h.overridden,
          overrideReason: working ? working.overrideReason : h.overrideReason,
        };
      });

      const res = await fetch("/api/rating-engine/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId: currentRace.id,
          decisions: decisionsPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit race decisions");
      }

      setToastMessage(
        "Race submitted successfully! Status is now REVIEWED (Read-Only)."
      );
      setTimeout(() => setToastMessage(""), 6000);

      setWorkingDecisions({});
      await loadRaces();
    } catch (err) {
      console.error("Submit error:", err);
      alert(err.message || "An error occurred while submitting the race.");
    } finally {
      setSubmitting(false);
    }
  };

  // Why this rating explanation sentence
  const whySentence = useMemo(() => {
    if (!activeHorse || !currentRace) return "";
    const name = activeHorse.horseName;
    const pl = activeHorse.placing;
    const runners = currentHorses.length || 9;
    const rType = currentRace.raceType || "Handicap";
    const refPos = pl === 4 ? "4th (Reference)" : `${pl}${getOrdinal(pl)}`;

    if (activeHorse.overridden) {
      return `${name} finished ${pl}${getOrdinal(
        pl
      )} in a ${runners}-horse ${rType} race. The automatic recommendation was adjusted by steward discretion: ${
        activeHorse.overrideReason || activeHorse.reasonsExplanation || "Handicapper override applied"
      }.`;
    }

    if (pl === 4) {
      return `${name} finished 4th in a ${runners}-horse ${rType} race. 4th is the reference position, so the rating does not change. No starter, veterinary or incident remark applies.`;
    }

    if (pl === 1) {
      return `${name} finished 1st (winner) in a ${runners}-horse ${rType} race. Winner receives rating increase based on cumulative coefficients and weight carried.`;
    }

    if (activeHorse.exception && activeHorse.exception !== "None") {
      return `${name} finished ${pl}${getOrdinal(
        pl
      )} in a ${runners}-horse ${rType} race. Exception condition noted (${
        activeHorse.exception
      }): rating evaluated with steward discretion safeguards.`;
    }

    if (activeHorse.reasonsExplanation) {
      return `${name} finished ${pl}${getOrdinal(
        pl
      )} in a ${runners}-horse ${rType} race. ${activeHorse.reasonsExplanation}`;
    }

    return `${name} finished ${pl}${getOrdinal(
      pl
    )} in a ${runners}-horse ${rType} race. Rating is calculated relative to median placing reference.`;
  }, [activeHorse, currentRace, currentHorses]);

  const overriddenCount = currentHorses.filter((h) => h.overridden).length;
  const keptCount = currentHorses.length - overriddenCount;

  return (
    <div className="space-y-6 pb-24">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-8 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage("")}
            className="text-slate-400 hover:text-white ml-2 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Page Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[#12306B] leading-tight">
            Rating Engine
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Automated race calculations, handicapper reviews, and coefficient controls
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isHandicapperOrAdmin && (
            <button
              type="button"
              onClick={handleAutoRate}
              disabled={autoRating || loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              title="Validate and re-calculate ratings against approved coefficient table"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoRating ? "animate-spin" : ""}`} />
              <span>{autoRating ? "Validating & Auto-Rating..." : "Auto-Rate & Validate"}</span>
            </button>
          )}

          {isViewer && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200">
              <Lock className="w-3.5 h-3.5 text-slate-500" /> Read-Only Mode (Viewer)
            </div>
          )}
        </div>
      </div>

      {/* 1. Files for this race day Card (Prototype Design - 6 Source Cards) */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#EEF2F6]">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Files for this race day
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ratings calculate automatically from master data, race results, and approved coefficient rules
            </p>
          </div>
        </div>

        {/* 6 Files Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
          {raceFiles.map((file, idx) => {
            const isReceived = file.status === "Received";
            const isUploaded = file.status === "Uploaded";
            const IconComponent = file.icon || Database;

            return (
              <div
                key={idx}
                className="p-3 rounded-lg border border-[#E2E8F0] bg-slate-50/50 flex flex-col justify-between min-h-[125px] hover:border-slate-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <IconComponent className="w-4 h-4 text-slate-500" />

                    {isReceived ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534]">
                        <span className="w-1 h-1 rounded-full bg-[#166534]" />
                        Received
                      </span>
                    ) : isUploaded ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534]">
                        <span className="w-1 h-1 rounded-full bg-[#166534]" />
                        Uploaded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E]">
                        <span className="w-1 h-1 rounded-full bg-[#D97706]" />
                        Not uploaded
                      </span>
                    )}
                  </div>

                  <div className="text-xs font-semibold text-slate-900 leading-snug line-clamp-1" title={file.name}>
                    {file.name}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5" title={file.detail}>
                    {file.detail}
                  </div>
                </div>

                {isHandicapperOrAdmin && (
                  <Link
                    href={`/upload?type=${file.fileType}`}
                    className="mt-2.5 pt-2 border-t border-slate-200/80 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                    title={`Upload or update ${file.name}`}
                  >
                    <Upload className="w-3 h-3" />
                    <span>Upload</span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer lock note & coefficient table info */}
        <div className="mt-4 pt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Approved coefficients v1 · locked (51 category & distance rules loaded)</span>
          </div>
          {isHandicapperOrAdmin && (
            <Link
              href="/upload?type=COEFFICIENT"
              className="text-[#2563EB] hover:underline font-semibold text-[11px] flex items-center gap-1"
            >
              <Upload className="w-3 h-3" />
              <span>Update Coefficient Table</span>
            </Link>
          )}
        </div>
      </div>

      {/* 2. Filters & Race Selection Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#EEF2F6]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Venue Dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">VENUE</label>
              <select
                value={venueFilter}
                onChange={(e) => setVenueFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Venues</option>
                {filterOptions.venues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Date dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">RACE DATE</label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Dates</option>
                {filterOptions.dates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Race Type dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">RACE TYPE</label>
              <select
                value={raceTypeFilter}
                onChange={(e) => handleRaceTypeChange(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Types</option>
                <option value="Handicap">Handicap</option>
                <option value="Terms">Terms</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Race No dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">RACE NO</label>
              <select
                value={raceNoFilter}
                onChange={(e) => setRaceNoFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Races</option>
                {(filterOptions.raceNos || []).map((no) => (
                  <option key={no} value={no}>
                    Race {no}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Category dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">CATEGORY</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">
                  {raceTypeFilter === "Handicap"
                    ? "All Handicap Categories"
                    : raceTypeFilter === "Terms"
                    ? "All Terms Categories"
                    : "All Categories"}
                </option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Distance dropdown */}
            <div className="relative">
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">DISTANCE</label>
              <select
                value={distanceFilter}
                onChange={(e) => setDistanceFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Distances</option>
                {filterOptions.distances.map((dist) => (
                  <option key={dist} value={dist}>
                    {dist} m
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
            </div>

            {/* Select Specific Race from filtered results */}
            {races.length > 0 && (
              <div className="relative">
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">SELECT RACE</label>
                <select
                  value={currentRace?.id || ""}
                  onChange={(e) => {
                    setSelectedRaceId(parseInt(e.target.value, 10));
                    setSelectedHorseId(null);
                    setWorkingDecisions({});
                  }}
                  className="appearance-none h-9 pl-3 pr-8 bg-[#EFF6FF] border border-blue-300 rounded-lg text-xs font-bold text-[#12306B] focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
                >
                  {races.map((r) => (
                    <option key={r.id} value={r.id}>
                      Race {r.raceNo} ({r.venue} · {r.category} · {r.distance}m · {r.raceType})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-6 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Race Status Badge */}
          {currentRace && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">
                {currentRace.venue} · {currentRace.category} · {currentRace.distance}m · {currentRace.raceType}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${
                  isRaceReviewed
                    ? "bg-slate-100 text-slate-700 border-slate-300"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}
              >
                {isRaceReviewed ? (
                  <>
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Reviewed (Locked)</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Awaiting Review</span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Horses Table Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Horses · Race {currentRace?.raceNo ?? 1}
            </h2>
            <p className="text-xs text-slate-500">
              Recommendations are generated by the system. Click any horse to inspect its detailed assessment trace.
            </p>
          </div>
          {currentHorses.length > 0 && (
            <span className="text-xs font-semibold text-slate-500">
              {currentHorses.length} runners
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  HORSE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  RACE TYPE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  CATEGORY
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  DISTANCE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                  PLACING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  TIMING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  CURRENT RATING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  CHANGE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  EXCEPTION
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  REASON EXPLANATION
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  ACTION
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#12306B]" />
                      <span>Loading race horses...</span>
                    </div>
                  </td>
                </tr>
              ) : currentHorses.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-5 py-8 text-center text-xs text-slate-400">
                    No horse data found for this race
                  </td>
                </tr>
              ) : (
                currentHorses.map((h) => {
                  const isSelected = activeHorse?.id === h.id;
                  const changeNum = Number(h.finalChange ?? 0);
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;

                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedHorseId(h.id)}
                      className={`h-[52px] cursor-pointer transition-colors ${
                        isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900 whitespace-nowrap">
                        <span className={isSelected ? "text-[#2563EB]" : ""}>
                          {h.horseName}
                        </span>
                        {h.cardNo && (
                          <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                            (Card #{h.cardNo})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            (h.raceType || currentRace?.raceType) === "Terms"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {h.raceType || currentRace?.raceType || "Handicap"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {h.raceCategory || currentRace?.category || "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {h.distance || currentRace?.distance
                          ? `${h.distance || currentRace.distance}m`
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 text-center whitespace-nowrap tabular-nums">
                        {h.placing ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap tabular-nums">
                        {h.timing || "—"}
                      </td>
                      <td className="px-3 py-3 text-sm font-bold text-slate-900 text-right whitespace-nowrap tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{h.finalRating ?? "—"}</span>
                          {h.overridden && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                              Overridden
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm font-bold text-right whitespace-nowrap tabular-nums">
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
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {h.ratingStatus === "NEEDS_HANDICAPPER" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold">
                            NEEDS_HANDICAPPER
                          </span>
                        ) : h.ratingStatus === "NOT_ELIGIBLE" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                            NOT_ELIGIBLE
                          </span>
                        ) : h.ratingStatus === "NOT_RATED" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-semibold">
                            NOT_RATED
                          </span>
                        ) : h.exception && h.exception !== "None" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px]">
                            {h.exception}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate" title={h.overrideReason || h.reasonsExplanation}>
                        {h.overrideReason || h.reasonsExplanation || "—"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isHandicapperOrAdmin && !isRaceReviewed ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOverrideModalHorse(h);
                            }}
                            className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                          >
                            Override
                          </button>
                        ) : isRaceReviewed ? (
                          <span className="text-xs text-slate-400 italic">Locked</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. "Why this rating" Detailed Explanation Card below Table (Prototype Design) */}
      {activeHorse && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">
            Why this rating · {activeHorse.horseName} · Race {currentRace?.raceNo ?? 1}
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Natural text sentence & summary pills */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                {whySentence}
              </p>

              <div className="flex items-center gap-3 pt-2">
                <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block font-medium uppercase tracking-wider">
                    Recommended
                  </span>
                  <span className="text-lg font-bold text-slate-900">
                    {activeHorse.recommendedRating ?? "—"} pts
                  </span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-[#EFF6FF] border border-blue-200">
                  <span className="text-[11px] text-[#2563EB] block font-semibold uppercase tracking-wider">
                    Final Rating
                  </span>
                  <span className="text-lg font-bold text-[#12306B]">
                    {activeHorse.finalRating ?? "—"} pts
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Steps 1..11 from Calculation Engine or Seven Tiles */}
            <div className="lg:col-span-7 text-xs">
              {Array.isArray(activeHorse.reasons) && activeHorse.reasons.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-800 pb-1 border-b border-[#EEF2F6] flex items-center justify-between">
                    <span>Engine Audit Trail (Steps 1 to 11)</span>
                    <span className="text-[11px] font-medium text-slate-500">
                      {activeHorse.ratingStatus}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto pr-1">
                    {activeHorse.reasons.map((r, idx) => {
                      const colonIdx = r.indexOf(":");
                      const stepLabel = colonIdx !== -1 ? r.slice(0, colonIdx) : `Step ${idx + 1}`;
                      const stepText = colonIdx !== -1 ? r.slice(colonIdx + 1).trim() : r;
                      return (
                        <div key={idx} className="flex items-start gap-2 py-1.5">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px] font-bold flex-shrink-0">
                            {stepLabel}
                          </span>
                          <span className="text-slate-700 leading-snug">
                            {stepText}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-[#EEF2F6]">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Race classification</span>
                    <span className="font-semibold text-slate-900">
                      {currentRace?.raceType || "Handicap"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Eligibility</span>
                    <span className="font-semibold text-slate-900">
                      {activeHorse.previousRuns ?? 5} runs, met
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Reference position</span>
                    <span className="font-semibold text-slate-900">
                      {activeHorse.placing === 4
                        ? `4th of ${currentHorses.length} (Reference Position)`
                        : `${activeHorse.placing}${getOrdinal(activeHorse.placing)} of ${currentHorses.length}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Weight adjustment</span>
                    <span className="font-semibold text-slate-900">
                      {activeHorse.weightCarried ? `${activeHorse.weightCarried} kg carried` : "0 kg, 0 points"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Coefficient calculation</span>
                    <span className="font-semibold text-slate-900">
                      {activeHorse.ratingStatus === "RATED"
                        ? `Cumulative, ${currentRace?.category || "60-85"}, ${currentRace?.distance || 1400}m`
                        : "Not applicable at reference"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Exception applied</span>
                    <span className="font-semibold text-slate-900">
                      {activeHorse.exception || "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-500 font-medium">Recommended rating</span>
                    <span className="font-bold text-[#12306B]">
                      {activeHorse.recommendedRating ?? "—"} pts
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Sticky Bottom Bar (Prototype Layout) */}
      <div className="fixed bottom-0 left-[240px] right-0 bg-white/95 backdrop-blur-sm border-t border-[#E2E8F0] px-8 py-3.5 flex items-center justify-between z-30 shadow-md">
        <div className="text-xs font-semibold text-slate-700">
          <span>{overriddenCount} horses overridden</span>
          <span className="mx-2 text-slate-300">·</span>
          <span>{keptCount} recommendations kept</span>
        </div>

        {isHandicapperOrAdmin && (
          <button
            type="button"
            onClick={handleSubmitRace}
            disabled={isRaceReviewed || submitting}
            className={`h-10 px-5 text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer ${
              isRaceReviewed
                ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                : submitting
                ? "bg-blue-400 text-white cursor-wait"
                : "bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
            }`}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>
              {isRaceReviewed ? "Review Finalised (Locked)" : submitting ? "Submitting..." : "Confirm review"}
            </span>
          </button>
        )}
      </div>

      {/* Override Dialog Modal */}
      {overrideModalHorse && (
        <OverrideDialog
          isOpen={!!overrideModalHorse}
          onClose={() => setOverrideModalHorse(null)}
          horse={overrideModalHorse}
          race={currentRace}
          user={user}
          onSave={handleSaveOverride}
        />
      )}
    </div>
  );
}

export default function RatingEnginePage() {
  return (
    <ProtectedPage>
      <AppShell>
        <Suspense
          fallback={
            <div className="p-8 text-center text-slate-400 text-xs">
              Loading Rating Engine...
            </div>
          }
        >
          <RatingEngineContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
