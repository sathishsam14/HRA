"use client";

import React, { Suspense, useState, useRef, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import Pill from "@/components/Pill";
import OverrideDialog from "@/components/OverrideDialog";
import { useData } from "@/lib/DataContext";
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
  Layers,
  ChevronDown,
  Upload,
  RotateCcw,
} from "lucide-react";

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function RatingEngineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRaceId = searchParams.get("race") || "R5";

  const {
    races,
    horses,
    filesByRace,
    confirmedRaces,
    confirmedHorses,
    saveOverride,
    confirmRace,
    confirmHorses,
    updateFileStatus,
    removeFileStatus,
  } = useData();

  const { user } = useAuth();
  const isHandicapper = user?.role === "Handicapper";

  const [selectedRaceId, setSelectedRaceId] = useState(initialRaceId);
  const [selectedRaceType, setSelectedRaceType] = useState("ALL");
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [checkedHorseIds, setCheckedHorseIds] = useState(new Set());
  const [overrideModalHorse, setOverrideModalHorse] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const fileInputRef = useRef(null);
  const [targetUploadIdx, setTargetUploadIdx] = useState(null);

  // Clear checked horse IDs when switching races
  useEffect(() => {
    setCheckedHorseIds(new Set());
  }, [selectedRaceId]);

  // Filter races by type (Handicap, Terms, ALL)
  const filteredRaces = useMemo(() => {
    return races.filter((r) => {
      if (selectedRaceType !== "ALL" && r.type !== selectedRaceType) return false;
      return true;
    });
  }, [races, selectedRaceType]);

  // Selected race object
  const currentRace = useMemo(() => {
    return races.find((r) => r.id === selectedRaceId) || races[0] || {};
  }, [races, selectedRaceId]);

  // Horses for current race ordered by placing
  const currentHorses = useMemo(() => {
    const list = horses.filter((h) => h.raceId === currentRace.id);
    return [...list].sort((a, b) => {
      const pA = a.placing ?? 999;
      const pB = b.placing ?? 999;
      return pA - pB;
    });
  }, [horses, currentRace.id]);

  if (currentHorses.length === 0 && horses.length > 0) {
    console.log("No horses for raceId:", currentRace.id, { allHorses: horses });
  }

  // Active selected horse (default to Desert Wind or 4th placing or first)
  const activeHorse = useMemo(() => {
    if (selectedHorseId) {
      const found = currentHorses.find((h) => h.id === selectedHorseId);
      if (found) return found;
    }
    // Default to 4th place or Desert Wind or first
    const fourth = currentHorses.find((h) => h.placing === 4);
    return fourth || currentHorses[0] || null;
  }, [currentHorses, selectedHorseId]);

  // Race files
  const raceFiles = filesByRace[currentRace.id] || [
    { name: "Master data", status: "Received", detail: "From FTP" },
    { name: "Previous race history", status: "Received", detail: "From FTP" },
    { name: "Current race data", status: "Uploaded", detail: `race_${currentRace.raceNo}.xlsx` },
    { name: "Starter report", status: "Uploaded", detail: `starter_${currentRace.raceNo}.docx` },
    { name: "Veterinary report", status: "Uploaded", detail: `vet_${currentRace.raceNo}.pdf` },
    { name: "Incident report", status: "Not uploaded", detail: "" },
  ];

  // Confirmation helpers (only confirmed horses are locked; NO unlock allowed!)
  const isHorseConfirmed = (horseId) => {
    return !!confirmedHorses?.[horseId];
  };

  const unconfirmedHorses = useMemo(() => {
    return currentHorses.filter((h) => !confirmedHorses?.[h.id]);
  }, [currentHorses, confirmedHorses]);

  const allHorsesConfirmed =
    currentHorses.length > 0 && currentHorses.every((h) => isHorseConfirmed(h.id));
  const someHorsesConfirmed = currentHorses.some((h) => isHorseConfirmed(h.id));
  const confirmedHorsesCount = currentHorses.filter((h) => isHorseConfirmed(h.id)).length;
  const isConfirmed = allHorsesConfirmed || currentRace.status === "Reviewed";

  // Checkbox selection helpers
  const isAllUnconfirmedChecked =
    unconfirmedHorses.length > 0 &&
    unconfirmedHorses.every((h) => checkedHorseIds.has(h.id));

  // Toggle check all unconfirmed horses
  const handleToggleSelectAll = () => {
    if (!isHandicapper || unconfirmedHorses.length === 0) return;
    if (isAllUnconfirmedChecked) {
      setCheckedHorseIds(new Set());
    } else {
      const next = new Set();
      unconfirmedHorses.forEach((h) => next.add(h.id));
      setCheckedHorseIds(next);
    }
  };

  // Toggle single horse checkbox
  const handleToggleHorseCheck = (horseId) => {
    if (!isHandicapper || isHorseConfirmed(horseId)) return;
    setCheckedHorseIds((prev) => {
      const next = new Set(prev);
      if (next.has(horseId)) {
        next.delete(horseId);
      } else {
        next.add(horseId);
      }
      return next;
    });
  };

  // Target horse IDs to confirm: checked horses, or currently clicked single active horse
  const targetsToConfirm = useMemo(() => {
    if (checkedHorseIds.size > 0) {
      return Array.from(checkedHorseIds);
    }
    if (activeHorse && !confirmedHorses?.[activeHorse.id]) {
      return [activeHorse.id];
    }
    return [];
  }, [checkedHorseIds, activeHorse, confirmedHorses]);

  // Execute confirm for targeted horses (NO UNLOCK!)
  const handleConfirmReview = () => {
    if (!isHandicapper || targetsToConfirm.length === 0) return;

    const willBeAllConfirmed =
      confirmedHorsesCount + targetsToConfirm.length >= currentHorses.length;

    confirmHorses(currentRace.id, targetsToConfirm, willBeAllConfirmed);
    setCheckedHorseIds(new Set());

    if (targetsToConfirm.length === 1) {
      const hObj = currentHorses.find((h) => h.id === targetsToConfirm[0]);
      setToastMessage(`Confirmed and locked ${hObj?.horseName || "horse"}`);
    } else {
      setToastMessage(`Confirmed and locked ${targetsToConfirm.length} horses`);
    }
    setTimeout(() => setToastMessage(""), 4000);
  };

  // Counts for sticky bottom bar
  const overriddenCount = currentHorses.filter((h) => h.override).length;
  const keptCount = currentHorses.length - overriddenCount;

  // File upload handler
  const handleOpenUpload = (fileIdx) => {
    setTargetUploadIdx(fileIdx);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && targetUploadIdx !== null) {
      updateFileStatus(currentRace.id, targetUploadIdx, file.name);
      setToastMessage("File received and checked");
      setTimeout(() => setToastMessage(""), 4000);
    }
  };

  const handleRemoveFile = (fileIdx, fileName) => {
    if (window.confirm(`Remove ${fileName || "uploaded file"}?`)) {
      removeFileStatus(currentRace.id, fileIdx);
      setToastMessage("File removed");
      setTimeout(() => setToastMessage(""), 4000);
    }
  };

  // Switch race handler
  const handleSelectRace = (newRaceId) => {
    setSelectedRaceId(newRaceId);
    setSelectedHorseId(null);
    router.replace(`/rating-engine/?race=${newRaceId}`);
  };



  // Why this rating explanation sentence
  const whySentence = useMemo(() => {
    if (!activeHorse) return "";
    const name = activeHorse.horseName;
    const pl = activeHorse.placing;
    const runners = currentRace.runners || currentHorses.length || 9;
    const rType = currentRace.type || "Handicap";
    const refPos = activeHorse.trace?.referencePosition || "4th";

    if (activeHorse.override) {
      return `${name} finished ${pl}${getOrdinal(pl)} in a ${runners}-horse ${rType} race. The automatic recommendation was adjusted by steward discretion: ${activeHorse.overrideReason || activeHorse.reason}.`;
    }

    if (pl === 4 || refPos.startsWith("4th") || refPos.startsWith("3rd")) {
      return `${name} finished ${pl}${getOrdinal(pl)} in a ${runners}-horse ${rType} race. ${refPos} is the reference position, so the rating does not change. No starter, veterinary or incident remark applies.`;
    }

    if (pl === 1) {
      return `${name} finished 1st (winner) in a ${runners}-horse ${rType} race. Winner receives rating increase based on cumulative coefficients and weight carried.`;
    }

    if (activeHorse.exception && activeHorse.exception !== "None") {
      return `${name} finished ${pl}${getOrdinal(pl)} in a ${runners}-horse ${rType} race. Exception condition applied (${activeHorse.exception}): rating does not decrease.`;
    }

    return `${name} finished ${pl}${getOrdinal(pl)} in a ${runners}-horse ${rType} race. Rating is calculated relative to median placing reference.`;
  }, [activeHorse, currentRace, currentHorses]);

  return (
    <div className="space-y-6 pb-20">
      {/* Hidden file input for file picker */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".xlsx,.xls,.csv,.docx,.pdf"
        className="hidden"
      />

      {/* Small Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-8 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Title */}
      <div>
        <h1 className="text-[28px] font-semibold text-[#12306B] leading-tight">
          Rating Engine
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Automated race calculations, handicapper reviews, and coefficient controls
        </p>
      </div>

      {/* 1. Files for this race day Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#EEF2F6]">
          <h2 className="text-base font-semibold text-slate-900">
            Files for this race day
          </h2>
          <span className="text-xs text-slate-500">
            Ratings are generated automatically when the files are in · Last run 07 Nov 2026, 14:05
          </span>
        </div>

        {/* 6 Files Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
          {raceFiles.map((file, idx) => {
            const isReceived = file.status === "Received";
            const isUploaded = file.status === "Uploaded";
            const isNotUploaded = file.status === "Not uploaded";

            return (
              <div
                key={idx}
                className="p-3 rounded-lg border border-[#E2E8F0] bg-slate-50/50 flex flex-col justify-between min-h-[105px]"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  {idx === 0 ? (
                    <Database className="w-4 h-4 text-slate-400" />
                  ) : idx === 1 ? (
                    <History className="w-4 h-4 text-slate-400" />
                  ) : idx === 2 ? (
                    <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                  ) : idx === 3 ? (
                    <FileText className="w-4 h-4 text-slate-400" />
                  ) : idx === 4 ? (
                    <FileText className="w-4 h-4 text-slate-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}

                  {isReceived ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534]">
                      <span className="w-1 h-1 rounded-full bg-[#166534]" />
                      Received
                    </span>
                  ) : isUploaded ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534]">
                      <span className="w-1 h-1 rounded-full bg-[#166534]" />
                      Uploaded
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E]">
                      <span className="w-1 h-1 rounded-full bg-[#D97706]" />
                      Not uploaded
                    </span>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-900 leading-snug truncate">
                    {file.name}
                  </div>
                  {isNotUploaded ? (
                    <button
                      type="button"
                      onClick={() => handleOpenUpload(idx)}
                      className="text-xs font-semibold text-[#2563EB] hover:underline mt-1 cursor-pointer block text-left"
                    >
                      Upload
                    </button>
                  ) : isUploaded ? (
                    <div className="mt-0.5">
                      <div className="text-[11px] text-slate-500 truncate" title={file.detail}>
                        {file.detail}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleOpenUpload(idx)}
                          className="font-medium text-[#2563EB] hover:underline cursor-pointer"
                        >
                          Replace
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx, file.name)}
                          className="font-medium text-rose-600 hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {file.detail || "Received"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer lock note */}
        <div className="mt-4 pt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          <span>Approved coefficients v1 · locked</span>
        </div>
      </div>

      {/* 2. Race card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        {/* Top Dropdown row */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#EEF2F6]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date dropdown */}
            <div className="relative">
              <select
                value={currentRace.date || "2026-11-07"}
                onChange={(e) => {
                  const targetDate = e.target.value;
                  const matching = races.filter(
                    (r) =>
                      r.date === targetDate &&
                      (selectedRaceType === "ALL" || r.type === selectedRaceType)
                  );
                  if (matching.length > 0) {
                    handleSelectRace(matching[0].id);
                  } else {
                    const anyOnDate = races.find((r) => r.date === targetDate);
                    if (anyOnDate) handleSelectRace(anyOnDate.id);
                  }
                }}
                className="appearance-none h-10 pl-3.5 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="2026-11-07">07 Nov 2026</option>
                <option value="2026-11-06">06 Nov 2026</option>
                <option value="2026-11-05">05 Nov 2026</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>

            {/* Race Type dropdown: Handicap and Terms */}
            <div className="relative">
              <select
                value={selectedRaceType}
                onChange={(e) => {
                  const newType = e.target.value;
                  setSelectedRaceType(newType);
                  const matching = races.filter((r) => newType === "ALL" || r.type === newType);
                  if (matching.length > 0 && !matching.some((r) => r.id === currentRace.id)) {
                    handleSelectRace(matching[0].id);
                  }
                }}
                className="appearance-none h-10 pl-3.5 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                <option value="ALL">All Race Types</option>
                <option value="Handicap">Handicap</option>
                <option value="Terms">Terms</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>

            {/* Race No dropdown */}
            <div className="relative">
              <select
                value={currentRace.id}
                onChange={(e) => handleSelectRace(e.target.value)}
                className="appearance-none h-10 pl-3.5 pr-8 bg-white border border-[#CBD5E1] rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
              >
                {filteredRaces.map((r) => (
                  <option key={r.id} value={r.id}>
                    Race {r.raceNo ?? r.id} ({r.type || "Handicap"})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>

          <div>
            {allHorsesConfirmed ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#166534]" />
                Reviewed
              </span>
            ) : someHorsesConfirmed || currentRace.status === "Partly reviewed" ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#64748B]" />
                Partly reviewed ({confirmedHorsesCount}/{currentHorses.length})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                Awaiting review
              </span>
            )}
          </div>
        </div>

        {/* Details row: Venue, Race season, Race type, Race category, Race no, Card no, Distance, Runners */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-4 pt-4">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Venue
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.venue || "BNG"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Race season
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.season || "2026-27"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Race type
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.type || "Handicap"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Race category
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.category || "60-85"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Race no
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.raceNo ?? 5}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Card no
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.cardNo ?? 2}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Distance
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.distance ? `${currentRace.distance} m` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Runners
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {currentRace.runners ?? currentHorses.length}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Horses card (Full Width) */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <h2 className="text-base font-semibold text-slate-900">
            Horses · Race {currentRace.raceNo ?? 5}
          </h2>
          <span className="text-xs text-slate-500">
            Recommendations are generated by the system. The Handicapper reviews and overrides only where needed.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                <th className="px-3 py-3 text-center w-[75px]">
                  <div
                    className="flex items-center justify-center gap-1 cursor-pointer select-none"
                    title={
                      isAllUnconfirmedChecked
                        ? "Deselect all unconfirmed"
                        : "Select all unconfirmed horses to confirm"
                    }
                    onClick={handleToggleSelectAll}
                  >
                    <input
                      type="checkbox"
                      checked={isAllUnconfirmedChecked && unconfirmedHorses.length > 0}
                      onChange={handleToggleSelectAll}
                      disabled={!isHandicapper || unconfirmedHorses.length === 0}
                      className="w-4 h-4 text-[#2563EB] rounded border-slate-300 focus:ring-[#2563EB] cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span className="text-[11px] font-semibold text-[#475569] uppercase">ALL</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  HORSE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  CURRENT
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                  PLACING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  TIMING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  VERDICT
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  RECOMMENDED
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  EXCEPTION
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  CHANGE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  FINAL
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
              {currentHorses.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-5 py-8 text-center text-xs text-slate-400">
                    No horse data found for this race
                  </td>
                </tr>
              ) : (
                currentHorses.map((h) => {
                  const isSelected = activeHorse?.id === h.id;
                  const changeNum = Number(h.finalChange ?? 0);
                  const isPositive = changeNum > 0;
                  const isNegative = changeNum < 0;
                  const horseConfirmed = isHorseConfirmed(h.id);

                  return (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedHorseId(h.id)}
                      className={`h-[52px] cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-[#EFF6FF]"
                          : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <td
                        className="px-3 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {horseConfirmed ? (
                          <div
                            className="flex items-center justify-center"
                            title="Confirmed and locked"
                          >
                            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">
                              ✓
                            </span>
                          </div>
                        ) : (
                          <input
                            type="checkbox"
                            checked={checkedHorseIds.has(h.id)}
                            onChange={() => handleToggleHorseCheck(h.id)}
                            disabled={!isHandicapper}
                            className="w-4 h-4 text-[#2563EB] rounded border-slate-300 focus:ring-[#2563EB] cursor-pointer"
                            title={`Select ${h.horseName} to confirm`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900 whitespace-nowrap">
                        <span className={isSelected ? "text-[#2563EB]" : ""}>
                          {h.horseName}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 text-right whitespace-nowrap tabular-nums">
                        {h.currentRating ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 text-center whitespace-nowrap tabular-nums">
                        {h.placing ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap tabular-nums">
                        {h.timing || "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap">
                        {h.verdict || "—"}
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-slate-900 text-right whitespace-nowrap tabular-nums">
                        {h.recommendedRating ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {h.exception && h.exception !== "None" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px]">
                            {h.exception}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
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
                      <td className="px-3 py-3 text-sm font-bold text-slate-900 text-right whitespace-nowrap tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{h.finalRating ?? "—"}</span>
                          {h.override && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                              Overridden
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                        {h.reason || "—"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {horseConfirmed ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#166534]" /> Confirmed
                          </span>
                        ) : isHandicapper && !h.override ? (
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
                        ) : h.override ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. "Why this rating" card below the table for the selected horse */}
      {activeHorse && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">
            Why this rating · {activeHorse.horseName} · Race {currentRace.raceNo ?? 5}
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

            {/* Right Column: Seven StepTiles / Rows from horse.trace */}
            <div className="lg:col-span-7 divide-y divide-[#EEF2F6] text-xs">
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Race classification</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.classification || currentRace.type || "Handicap"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Eligibility</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.eligibility || "3 runs, met"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Reference position</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.referencePosition || "4th (9 runners)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Weight adjustment</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.weightAdjustment || "0 kg, 0 points"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Coefficient calculation</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.coefficient || "Not applicable at reference"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Exception applied</span>
                <span className="font-semibold text-slate-900">
                  {activeHorse.trace?.exceptionApplied || activeHorse.exception || "None"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 font-medium">Recommended rating</span>
                <span className="font-bold text-[#12306B]">
                  {activeHorse.recommendedRating ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-[240px] right-0 bg-white/95 backdrop-blur-sm border-t border-[#E2E8F0] px-8 py-3.5 flex items-center justify-between z-30 shadow-md">
        <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
          <span>{overriddenCount} horses overridden</span>
          <span className="text-slate-300">·</span>
          <span>{keptCount} recommendations kept</span>
          <span className="text-slate-300">·</span>
          <span className="text-[#2563EB]">
            {confirmedHorsesCount} of {currentHorses.length} confirmed
          </span>
        </div>

        {isHandicapper && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirmReview}
              disabled={allHorsesConfirmed || targetsToConfirm.length === 0}
              className={`h-10 px-5 text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer ${
                allHorsesConfirmed || targetsToConfirm.length === 0
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : allHorsesConfirmed || confirmedHorsesCount + targetsToConfirm.length >= currentHorses.length
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {allHorsesConfirmed
                  ? "All horses confirmed"
                  : checkedHorseIds.size > 1
                  ? `Confirm review (${checkedHorseIds.size} horses)`
                  : checkedHorseIds.size === 1
                  ? "Confirm review (1 horse)"
                  : activeHorse && !isHorseConfirmed(activeHorse.id)
                  ? `Confirm review (${activeHorse.horseName})`
                  : "Confirm review"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Override Dialog Modal (Handicapper only) */}
      {isHandicapper && overrideModalHorse && (
        <OverrideDialog
          isOpen={!!overrideModalHorse}
          onClose={() => setOverrideModalHorse(null)}
          horse={overrideModalHorse}
          race={currentRace}
          user={user}
          onSave={(overrideData) => {
            saveOverride(overrideModalHorse.id, overrideData, overrideModalHorse, user);
          }}
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
