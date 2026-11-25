"use client";

import React, { Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import OverrideDialog from "@/components/OverrideDialog";
import SharedUploadCards from "@/components/SharedUploadCards";
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
  Loader2,
  Upload,
  Flag,
  Download,
  Sparkles,
} from "lucide-react";

function getOrdinal(n) {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatReportDate(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function parseJustification(text) {
  if (!text || typeof text !== "string") return {};

  const sentences = text.split(/(?<=\.)\s+/);
  const resultSentence = sentences[0] || "";
  const ruleMatch = text.match(/BTC history[^:]*:\s*typical change\s*([+-]?\d+)/i);
  const downMatch = text.match(/Statistical downgrade likelihood[^:]*:\s*(\d+%)/i);
  const numMatch = text.match(/Numerical indicators:\s*([^.(]+)/i);
  const adjMatch = text.match(/model adjustment to the rule value\s*([+-]?\d+(?:\.\d+)?)/i);
  const repMatch = text.match(/Steward\/vet\/starter reports[^:]*:\s*([^.]+)/i);
  const noRepMatch = text.match(/No adverse remarks/i);

  return {
    finishDetail: resultSentence,
    ruleChange: ruleMatch ? ruleMatch[1] : null,
    downgradeLikelihood: downMatch ? downMatch[1] : null,
    numericalIndicators: numMatch ? numMatch[1].trim() : null,
    modelAdjustment: adjMatch ? adjMatch[1] : null,
    reportsSummary: repMatch
      ? repMatch[1].trim()
      : noRepMatch
      ? "Checked clear: No adverse remarks in reports"
      : null,
  };
}

function RatingEngineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRaceParam = searchParams.get("race");

  const { user } = useAuth();
  const isHandicapper = user?.role === "HANDICAPPER";
  const isHandicapperOrAdmin = user?.role === "HANDICAPPER" || user?.role === "ADMIN";
  const canUpload = user?.role === "HANDICAPPER" || user?.role === "ADMIN" || user?.role === "MANAGER";
  const isManager = user?.role === "MANAGER";

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
  const [toastMessage, setToastMessage] = useState("");
  const [overrideModalHorse, setOverrideModalHorse] = useState(null);
  const [selectedHorseId, setSelectedHorseId] = useState(null);
  const [patternInfo, setPatternInfo] = useState(null);
  const [ratingModeLabel, setRatingModeLabel] = useState("Pattern Mode");
  const [masterDataReady, setMasterDataReady] = useState(false);
  const [masterEntries, setMasterEntries] = useState(0);
  const [generatingRating, setGeneratingRating] = useState(false);

  // Track uploaded files status in rating engine
  const [uploadedFilesState, setUploadedFilesState] = useState({
    RACE: { uploaded: false, fileName: "", detail: "Current race day results (.xlsx)" },
    STARTER: { uploaded: false, fileName: "", detail: "Optional (.docx, .pdf, .xlsx)" },
    VETERINARY: { uploaded: false, fileName: "", detail: "Optional (.docx, .pdf, .xlsx)" },
    INCIDENT: { uploaded: false, fileName: "", detail: "Optional (.docx, .pdf, .xlsx)" },
    HISTORY: { uploaded: false, fileName: "", detail: "Consolidated previous race history (.xlsx)" },
    ACTIVE_HORSE: { uploaded: false, fileName: "", detail: "Active Horse Previous perfomance report.xlsx" },
    COEFFICIENT: { uploaded: false, fileName: "", detail: "Coefficient_Table.xlsx (51 rules)" },
  });

  const [uploadingFileType, setUploadingFileType] = useState(null);

  // Dedicated state for 4 optional report upload fields
  const [reportCardsState, setReportCardsState] = useState({
    STARTER: {
      label: "Starter",
      lastUploadedAt: null,
      fileName: null,
      uploading: false,
      uploadingFileName: "",
      error: null,
      result: null,
    },
    VETERINARY: {
      label: "Veterinary",
      lastUploadedAt: null,
      fileName: null,
      uploading: false,
      uploadingFileName: "",
      error: null,
      result: null,
    },
    INCIDENT: {
      label: "Incidence",
      lastUploadedAt: null,
      fileName: null,
      uploading: false,
      uploadingFileName: "",
      error: null,
      result: null,
    },
    STIPE: {
      label: "Stipe (Stipendiary Stewards)",
      lastUploadedAt: null,
      fileName: null,
      uploading: false,
      uploadingFileName: "",
      error: null,
      result: null,
    },
  });

  // Check existing upload records on mount and after uploads
  const checkExistingUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/upload");
      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];
        setUploadedFilesState((prev) => {
          const next = { ...prev };
          for (const f of files) {
            const t = f.fileType;
            if (next[t]) {
              next[t] = {
                uploaded: f.status === "PROCESSED" || f.status === "SKIPPED",
                fileName: f.name || f.fileName,
                detail: f.name || f.fileName,
              };
            }
          }
          return next;
        });

        // Also populate reportCardsState with last upload timestamp & fileName
        setReportCardsState((prev) => {
          const next = { ...prev };
          for (const key of ["STARTER", "VETERINARY", "INCIDENT", "STIPE"]) {
            const matchedFile = files.find((f) => f.fileType === key);
            if (matchedFile) {
              next[key] = {
                ...next[key],
                lastUploadedAt: matchedFile.uploadedAt,
                fileName: matchedFile.name || matchedFile.fileName,
              };
            }
          }
          return next;
        });
      }
    } catch (err) {
      console.warn("Could not check uploaded files status:", err);
    }
  }, []);

  useEffect(() => {
    checkExistingUploads();
  }, [checkExistingUploads]);

  // Handle direct file upload from race day cards and trigger auto-rating
  const handleCardFileUpload = async (fileType, file) => {
    if (!file || !canUpload) return;

    try {
      setUploadingFileType(fileType);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileType", fileType);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Failed to process file");
      }

      const fileLabel =
        fileType === "RACE"
          ? "Current Race Data"
          : fileType === "STARTER"
          ? "Starter Report"
          : fileType === "VETERINARY"
          ? "Veterinary Report"
          : fileType === "INCIDENT"
          ? "Incidence Report"
          : fileType;

      setToastMessage(
        `${fileLabel} uploaded successfully! Auto-rating and exceptions applied.`
      );
      setTimeout(() => setToastMessage(""), 6000);

      await checkExistingUploads();
      await loadRaces();
    } catch (err) {
      console.error("Direct upload error:", err);
      alert(err.message || "An error occurred during file upload.");
    } finally {
      setUploadingFileType(null);
    }
  };

  // Handle report upload (.docx, .doc, .pdf, .txt, .xlsx, .xls, .csv) for Starter, Veterinary, Incidence, Stipe
  const handleReportUpload = async (reportType, file) => {
    if (!file || !canUpload) return;

    // Reset previous error and result for this card
    setReportCardsState((prev) => ({
      ...prev,
      [reportType]: {
        ...prev[reportType],
        uploading: true,
        uploadingFileName: file.name,
        error: null,
      },
    }));

    const lowerName = file.name.toLowerCase();
    const validExtensions = [".docx", ".doc", ".pdf", ".txt", ".xlsx", ".xls", ".csv"];
    const isValidExt = validExtensions.some((ext) => lowerName.endsWith(ext));

    if (!isValidExt) {
      setReportCardsState((prev) => ({
        ...prev,
        [reportType]: {
          ...prev[reportType],
          uploading: false,
          uploadingFileName: "",
          error: "Invalid file format. Accepted formats: Word, PDF, Excel, CSV, text.",
        },
      }));
      return;
    }

    if (file.size === 0) {
      setReportCardsState((prev) => ({
        ...prev,
        [reportType]: {
          ...prev[reportType],
          uploading: false,
          uploadingFileName: "",
          error: "Selected file is empty (0 bytes). Please upload a valid report.",
        },
      }));
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileType", reportType);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Failed to process report file");
      }

      const result = data.result || {};
      const totalRemarks = result.totalRemarks ?? result.savedRows ?? 0;
      const linkedCount = result.linkedCount ?? result.savedRows ?? 0;
      const unmatchedNames = result.unmatchedNames || [];
      const format = result.format || (
        lowerName.endsWith(".docx") || lowerName.endsWith(".doc") ? "Word" :
        lowerName.endsWith(".pdf") ? "PDF" :
        lowerName.endsWith(".csv") ? "CSV" :
        lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") ? "Excel" :
        "Text"
      );

      setReportCardsState((prev) => ({
        ...prev,
        [reportType]: {
          ...prev[reportType],
          uploading: false,
          uploadingFileName: "",
          fileName: file.name,
          lastUploadedAt: new Date().toISOString(),
          error: null,
          result: {
            fileName: file.name,
            format,
            totalRemarks,
            linkedCount,
            unmatchedNames,
          },
        },
      }));

      const reportLabel = reportCardsState[reportType]?.label || reportType;
      setToastMessage(
        `${reportLabel} (${format}) report processed: ${linkedCount} remarks linked to horses.`
      );
      setTimeout(() => setToastMessage(""), 5000);

      // Re-fetch races and upload statuses (touches only open races via processWordReport)
      await checkExistingUploads();
      await loadRaces();
    } catch (err) {
      console.error("Report upload error:", err);
      setReportCardsState((prev) => ({
        ...prev,
        [reportType]: {
          ...prev[reportType],
          uploading: false,
          uploadingFileName: "",
          error: err.message || "Failed to upload and process report.",
        },
      }));
    }
  };

  // Fetch races from server with seamless fast caching
  const loadRaces = async () => {
    const params = new URLSearchParams();
    if (venueFilter !== "ALL") params.set("venue", venueFilter);
    if (dateFilter !== "ALL") params.set("raceDate", dateFilter);
    if (raceTypeFilter !== "ALL") params.set("raceType", raceTypeFilter);
    if (raceNoFilter !== "ALL") params.set("raceNo", raceNoFilter);
    if (categoryFilter !== "ALL") params.set("category", categoryFilter);
    if (distanceFilter !== "ALL") params.set("distance", distanceFilter);

    try {
      // Only show full-table loading spinner on initial cold load; instant cached update otherwise
      if (races.length === 0) {
        setLoading(true);
      }
      setError(null);

      const res = await fetch(`/api/rating-engine/races?${params.toString()}`, {
        cache: "default",
      });
      if (!res.ok) {
        throw new Error("Failed to load race data from server");
      }

      const data = await res.json();

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
      if (data.patternInfo) {
        setPatternInfo(data.patternInfo);
      }
      if (data.ratingModeLabel) {
        setRatingModeLabel(data.ratingModeLabel);
      }
      if (data.masterDataReady !== undefined) {
        setMasterDataReady(Boolean(data.masterDataReady));
      }
      if (data.masterEntries !== undefined) {
        setMasterEntries(data.masterEntries);
      }

      // Initialize selected race: default to ALL when viewing all races
      if (data.races && data.races.length > 0) {
        if (selectedRaceId && (selectedRaceId === "ALL" || data.races.some((r) => r.id === selectedRaceId))) {
          // Keep current
        } else if (raceNoFilter === "ALL") {
          setSelectedRaceId("ALL");
        } else {
          setSelectedRaceId(data.races[0].id);
        }
      } else {
        setSelectedRaceId(null);
      }
    } catch (err) {
      console.error("Error loading races:", err);
      setError(err.message || "Failed to load races");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRaces();
  }, [venueFilter, dateFilter, raceTypeFilter, raceNoFilter, categoryFilter, distanceFilter]);

  // Selected race object
  const currentRace = useMemo(() => {
    if (selectedRaceId && selectedRaceId !== "ALL") {
      return races.find((r) => r.id === selectedRaceId) || races[0] || null;
    }
    return races[0] || null;
  }, [races, selectedRaceId]);

  const isAllRacesView = raceNoFilter === "ALL" && selectedRaceId === "ALL";

  // Entries for displayed race(s) with working overrides merged
  const currentHorses = useMemo(() => {
    const rawEntries = (selectedRaceId === "ALL" || raceNoFilter === "ALL")
      ? races.flatMap((r) => r.entries || [])
      : currentRace?.entries || [];

    return rawEntries.map((entry) => {
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
  }, [selectedRaceId, raceNoFilter, races, currentRace, workingDecisions]);

  // Real count of horses, races, dates on screen (Requirement 4)
  const totalMatchingHorses = currentHorses.length;
  const totalMatchingRaces = useMemo(() => {
    return new Set(currentHorses.map((h) => `${h.raceDate}_${h.raceNo}`)).size;
  }, [currentHorses]);
  const totalMatchingDates = useMemo(() => {
    return new Set(currentHorses.map((h) => h.raceDate)).size;
  }, [currentHorses]);

  // Target race to confirm for sticky bottom bar (Requirement 5)
  const [targetConfirmRaceId, setTargetConfirmRaceId] = useState(null);

  useEffect(() => {
    if (races.length > 0) {
      if (!targetConfirmRaceId || !races.some((r) => r.id === targetConfirmRaceId)) {
        setTargetConfirmRaceId(races[0].id);
      }
    } else {
      setTargetConfirmRaceId(null);
    }
  }, [races, targetConfirmRaceId]);

  const targetRaceToConfirm = useMemo(() => {
    return races.find((r) => r.id === targetConfirmRaceId) || currentRace;
  }, [races, targetConfirmRaceId, currentRace]);

  const isTargetRaceReviewed = targetRaceToConfirm?.status === "REVIEWED";

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

  // Condition to enable/disable Generate Rating button
  const isGenerateDisabled =
    uploadingFileType !== null ||
    generatingRating ||
    !masterDataReady ||
    !currentHorses ||
    currentHorses.length === 0;

  // Handler for Generate Rating button: calls Python ML backend for the race(s)
  const handleGenerateRating = async () => {
    if (isGenerateDisabled) return;

    try {
      setGeneratingRating(true);
      setToastMessage("Generating ratings using Python ML Backend...");

      const res = await fetch("/api/rating-engine/re-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceId: selectedRaceId || "ALL" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate ratings");
      }

      setToastMessage("Ratings successfully generated by Python ML Engine!");
      setTimeout(() => setToastMessage(""), 5000);

      await loadRaces();
    } catch (err) {
      console.error("Generate rating error:", err);
      alert(err.message || "Failed to generate ratings.");
    } finally {
      setGeneratingRating(false);
    }
  };

  // Race files state: Master Data (managed on server) + Current Race Data (uploadable)
  const raceFiles = useMemo(() => {
    const isCurrentRaceDone = uploadedFilesState.RACE?.uploaded || (races && races.length > 0);

    return [
      {
        name: "Master Data (BSM)",
        fileType: "MASTER",
        status: masterDataReady ? "Active / Ready" : "Checking Server...",
        detail: masterDataReady
          ? `Server / SFTP (${masterEntries.toLocaleString()} historical runs loaded)`
          : "Historical dataset on server (BSM.xlsx)",
        icon: Database,
        accept: "",
        hint: "Baseline training data (local server / SFTP)",
        isPrimary: true,
        canUpload: false,
      },
      {
        name: "Current Race Data (BWM)",
        fileType: "RACE",
        status: isCurrentRaceDone ? "Uploaded" : "Not uploaded",
        detail: uploadedFilesState.RACE?.fileName || (currentRace ? `${currentRace.venue} · ${currentRace.raceDate}` : "Upload race day results (.xlsx)"),
        icon: Flag,
        accept: ".xlsx,.xls",
        hint: "Current race entries & placings",
        isPrimary: true,
        canUpload: true,
      },
    ];
  }, [currentRace, races, uploadedFilesState, masterDataReady, masterEntries]);

  // Handle override save with immediate database persistence and audit logging
  const handleSaveOverride = async (overrideData) => {
    if (!overrideModalHorse) return;

    try {
      const res = await fetch("/api/rating-engine/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: overrideModalHorse.id,
          finalChange: overrideData.finalChange,
          reason: overrideData.reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record override");
      }

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
        `Override recorded in Audit Trail for ${overrideModalHorse.horseName}: Change ${
          overrideData.finalChange > 0
            ? `+${overrideData.finalChange}`
            : overrideData.finalChange
        } (Rating: ${overrideData.finalRating})`
      );
      setTimeout(() => setToastMessage(""), 5000);
      setOverrideModalHorse(null);
      await loadRaces();
    } catch (err) {
      console.error("Save override error:", err);
      alert(err.message || "Failed to save override");
    }
  };

  // Submit race review to server (works per race - Requirement 5)
  const handleSubmitRace = async (raceIdToSubmit) => {
    const targetId = raceIdToSubmit || (selectedRaceId !== "ALL" ? selectedRaceId : targetConfirmRaceId || currentRace?.id);
    const raceObj = races.find((r) => r.id === targetId);
    if (!raceObj || raceObj.status === "REVIEWED" || !isHandicapperOrAdmin) return;

    const horsesForThisRace = currentHorses.filter((h) => h.raceNo === raceObj.raceNo && h.raceDate === raceObj.raceDate);

    const raceUnresolved = horsesForThisRace.filter((h) => {
      if (h.ratingStatus !== "NEEDS_HANDICAPPER") return false;
      const working = workingDecisions[h.id];
      if (working && Number.isFinite(working.finalChange) && Number.isFinite(working.finalRating)) return false;
      if (h.overridden && Number.isFinite(h.finalChange)) return false;
      return true;
    });

    if (raceUnresolved.length > 0) {
      alert(
        `Cannot submit Race ${raceObj.raceNo}: ${raceUnresolved.length} horse(s) with NEEDS_HANDICAPPER status must be decided by the Handicapper first.`
      );
      return;
    }

    try {
      setSubmitting(true);

      const decisionsPayload = horsesForThisRace.map((h) => {
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
          raceId: raceObj.id,
          decisions: decisionsPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to submit Race ${raceObj.raceNo}`);
      }

      setToastMessage(
        `Race ${raceObj.raceNo} confirmed successfully! Submitted to MIS & removed from Open races.`
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
    const name = activeHorse.horseName || "Horse";
    const pl = activeHorse.placing;
    const runners = currentHorses.length || currentRace.entries?.length || 0;
    const rType = currentRace.raceType || "Handicap";
    const cat = currentRace.category ? `Category ${currentRace.category}` : "";
    const dist = currentRace.distance ? `${currentRace.distance}m` : "";
    const details = [cat, dist].filter(Boolean).join(", ");
    const raceContext = details ? ` (${details})` : "";
    const curr = activeHorse.currentRating;
    const recRating = activeHorse.recommendedRating;
    const recChange = activeHorse.recommendedChange;
    const finalRating = activeHorse.finalRating;
    const finalChange = activeHorse.finalChange;
    const reasons = Array.isArray(activeHorse.reasons) ? activeHorse.reasons : [];

    const findReason = (prefix) =>
      reasons.find((r) => typeof r === "string" && r.toLowerCase().startsWith(prefix.toLowerCase()));

    // 1. Handicapper Override
    if (activeHorse.overridden) {
      const plText = pl ? `finished ${pl}${getOrdinal(pl)}` : "ran";
      const reasonNote = activeHorse.overrideReason?.trim()
        ? `: "${activeHorse.overrideReason.trim()}"`
        : "";
      const recSign = recChange != null && recChange >= 0 ? "+" : "";
      const finalSign = finalChange != null && finalChange >= 0 ? "+" : "";
      return `${name} ${plText} in an ${runners}-runner ${rType} race${raceContext}. The automated recommendation of ${recRating ?? "—"} pts (${recSign}${recChange ?? 0}) was adjusted by handicapper discretion to ${finalRating ?? "—"} pts (${finalSign}${finalChange ?? 0})${reasonNote}.`;
    }

    // 2. Unplaced / Did not finish
    if (!pl || pl < 1 || activeHorse.ratingStatus === "NOT_RATED") {
      return `${name} did not record an official finishing position in this ${rType} race${raceContext} and was not rated.`;
    }

    const plText = `${pl}${getOrdinal(pl)}`;

    // 3. Not eligible (minimum 3 runs)
    if (
      activeHorse.ratingStatus === "NOT_ELIGIBLE" ||
      (activeHorse.previousRuns != null && activeHorse.previousRuns < 3 && pl !== 1)
    ) {
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}. The horse is not yet eligible for an official rating adjustment, having completed ${activeHorse.previousRuns ?? 0} previous run(s) against the required minimum of 3.`;
    }

    // 4. Needs Handicapper
    if (activeHorse.ratingStatus === "NEEDS_HANDICAPPER") {
      const stepMsg = reasons[reasons.length - 1] || "";
      const cleanMsg = typeof stepMsg === "string" ? stepMsg.replace(/^Step \d+:\s*/i, "").trim() : "";
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}. Automatic rating requires handicapper review${cleanMsg ? `: ${cleanMsg}` : "."}`;
    }

    // 5. Constant condition
    const constantStep = findReason("Step 4:");
    if (activeHorse.ratingStatus === "UNCHANGED" || constantStep) {
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}. An official constant condition applies, maintaining the rating unchanged at ${curr ?? finalRating} pts.`;
    }

    // Reference position (benchmark) & step differences
    const step7 = findReason("Step 7:");
    let ref = runners >= 8 ? 4 : (runners >= 4 ? 3 : null);
    let rawChange = null;
    if (step7) {
      const refMatch = step7.match(/reference position (\d+)/i);
      if (refMatch) ref = parseInt(refMatch[1], 10);
      const stepMatch = step7.match(/(-?\d+)\s+step\(s\)\s*=\s*(-?\d+(?:\.\d+)?)/i);
      if (stepMatch) rawChange = parseFloat(stepMatch[2]);
    }
    if (ref == null && pl) {
      ref = runners >= 8 ? 4 : 3;
    }

    const step6 = findReason("Step 6:");
    let stepVal = null;
    if (step6) {
      const svMatch = step6.match(/step value\s+([\d.]+)/i);
      if (svMatch) stepVal = parseFloat(svMatch[1]);
    }

    const hasException = reasons.some(
      (r) => typeof r === "string" && (r.includes("exception found") || r.includes("exception from Step 5 applies"))
    );
    const isTermsNoDecrease = reasons.some(
      (r) => typeof r === "string" && r.includes("Terms race, not performed to potential, so no decrease")
    );
    const isCapApplied = reasons.some(
      (r) => typeof r === "string" && r.includes("decrease limited to")
    );

    // 6. Benchmark position (e.g. 4th place)
    if (ref != null && pl === ref) {
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}. As ${plText} is the designated benchmark reference position, no adjustment was applied, keeping the rating unchanged at ${curr ?? finalRating} pts.`;
    }

    // 7. Race Winner (1st place)
    if (pl === 1) {
      const beatHigher = reasons.some((r) => typeof r === "string" && r.includes("beat a higher-rated horse"));
      const weightAdj = findReason("Step 9:");
      let note = "";
      if (beatHigher) note += " after defeating higher-rated opposition";
      if (weightAdj && !weightAdj.includes("+0")) note += " with weight performance factored in";
      const chgSign = recChange != null && recChange >= 0 ? "+" : "";
      return `${name} won the race (1st place) in an ${runners}-runner ${rType} race${raceContext}${note}. Awarded a ${chgSign}${recChange ?? 0} pt adjustment, moving the rating from ${curr ?? "—"} to ${finalRating ?? recRating ?? "—"} pts.`;
    }

    // 8. Finished ahead of benchmark (e.g. 2nd or 3rd)
    if (ref != null && pl < ref) {
      const positionsAhead = ref - pl;
      const chgSign = recChange != null && recChange >= 0 ? "+" : "";
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}, placing ${positionsAhead} position${positionsAhead > 1 ? "s" : ""} ahead of the ${ref}${getOrdinal(ref)}-place benchmark. Awarded a ${chgSign}${recChange ?? 0} pt increase, adjusting the rating from ${curr ?? "—"} to ${finalRating ?? recRating ?? "—"} pts.`;
    }

    // 9. Finished behind benchmark (e.g. 8th in 11 runners)
    if (ref != null && pl > ref) {
      const positionsBehind = pl - ref;

      if (hasException) {
        return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}, ${positionsBehind} position${positionsBehind > 1 ? "s" : ""} behind the ${ref}${getOrdinal(ref)}-place benchmark. An official race exception was recorded, protecting the rating from downward revision at ${curr ?? finalRating} pts.`;
      }

      if (isTermsNoDecrease) {
        return `${name} finished ${plText} in an ${runners}-runner Terms race${raceContext}, ${positionsBehind} position${positionsBehind > 1 ? "s" : ""} behind the ${ref}${getOrdinal(ref)}-place benchmark. Under Terms race conditions, ratings are protected against downward revision, remaining at ${curr ?? finalRating} pts.`;
      }

      if (isCapApplied) {
        const rawPts = rawChange != null ? Math.round(rawChange) : (stepVal ? Math.round(-positionsBehind * stepVal) : null);
        const perPos = stepVal ? ` (-${stepVal} pts per position)` : "";
        const rawNote = rawPts != null ? ` (calculated at ${rawPts} pts${perPos})` : "";
        return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}, ${positionsBehind} position${positionsBehind > 1 ? "s" : ""} behind the ${ref}${getOrdinal(ref)}-place benchmark. The downward adjustment${rawNote} was capped at -4 pts under standard decrease limits, adjusting the rating from ${curr ?? "—"} to ${finalRating ?? recRating ?? "—"} pts.`;
      }

      const drop = Math.abs(recChange ?? 0);
      return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}, ${positionsBehind} position${positionsBehind > 1 ? "s" : ""} behind the ${ref}${getOrdinal(ref)}-place benchmark. With a -${drop} pt adjustment applied, the rating moves from ${curr ?? "—"} to ${finalRating ?? recRating ?? "—"} pts.`;
    }

    // 10. Fallback summary
    const chgStr = recChange != null ? `${recChange >= 0 ? "+" : ""}${recChange} pts` : "no change";
    return `${name} finished ${plText} in an ${runners}-runner ${rType} race${raceContext}. Rating evaluated relative to the benchmark placing with an adjustment of ${chgStr}, setting the rating to ${finalRating ?? recRating ?? "—"} pts.`;
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
              onClick={handleGenerateRating}
              disabled={isGenerateDisabled}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all select-none ${
                isGenerateDisabled
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-700/20 active:scale-[0.98]"
              }`}
              title={
                !masterDataReady
                  ? "Master data (BSM.xlsx) not loaded on backend"
                  : uploadingFileType !== null
                  ? "File upload in progress..."
                  : !currentRace
                  ? "Please upload a Current Race file first"
                  : "Run Python ML model on current race with report evidence"
              }
            >
              {generatingRating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Calculating Ratings...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Rating</span>
                </>
              )}
            </button>
          )}

          {isManager && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200">
              <Lock className="w-3.5 h-3.5 text-slate-500" /> Read-Only Mode (Manager)
            </div>
          )}
        </div>
      </div>

      {/* 1. Files for this race day Card (ONE single column, exactly 6 fields via SharedUploadCards) */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#EEF2F6]">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Files for this race day
            </h2>
          </div>
        </div>

        <div className="mt-5">
          <SharedUploadCards
            isHandicapperOrAdmin={canUpload}
            onUploadSuccess={() => {
              loadRaces();
            }}
          />
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
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setRaceNoFilter("ALL");
                  setSelectedRaceId("ALL");
                  setSelectedHorseId(null);
                }}
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
                onChange={(e) => {
                  const val = e.target.value;
                  setRaceNoFilter(val);
                  if (val === "ALL") {
                    setSelectedRaceId("ALL");
                  } else {
                    const match = races.find((r) => String(r.raceNo) === String(val));
                    if (match) setSelectedRaceId(match.id);
                  }
                  setSelectedHorseId(null);
                }}
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
                  value={selectedRaceId || "ALL"}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "ALL") {
                      setSelectedRaceId("ALL");
                      setRaceNoFilter("ALL");
                    } else {
                      const parsed = parseInt(val, 10);
                      setSelectedRaceId(parsed);
                      const match = races.find((r) => r.id === parsed);
                      if (match) setRaceNoFilter(String(match.raceNo));
                    }
                    setSelectedHorseId(null);
                  }}
                  className="appearance-none h-9 pl-3 pr-8 bg-[#EFF6FF] border border-blue-300 rounded-lg text-xs font-bold text-[#12306B] focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
                >
                  <option value="ALL">
                    All Races ({totalMatchingHorses} horses)
                  </option>
                  {races.map((r) => (
                    <option key={r.id} value={r.id}>
                      Race {r.raceNo} ({r.venue} · {r.raceDateFormatted || r.raceDate} · {r.category} · {r.distance}m · {r.runnersCount} runners)
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
                {selectedRaceId === "ALL" || raceNoFilter === "ALL"
                  ? "All Races View"
                  : `${currentRace.venue} · Race ${currentRace.raceNo} · ${currentRace.category} · ${currentRace.distance}m · ${currentRace.raceType}`}
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
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {selectedRaceId === "ALL" || raceNoFilter === "ALL" ? "Horses · All Races" : `Horses · Race ${currentRace?.raceNo ?? 1}`}
              </h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {totalMatchingHorses} horses, {totalMatchingRaces} races, {totalMatchingDates} dates
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Recommendations are generated by the system. Click any horse to inspect its detailed assessment trace.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {currentHorses.filter((h) => h.ratingDiffersFromMaster).length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  {currentHorses.filter((h) => h.ratingDiffersFromMaster).length} rating
                  {currentHorses.filter((h) => h.ratingDiffersFromMaster).length > 1 ? "s" : ""} differ from master data
                </span>
              </span>
            )}
            {currentHorses.length === 0 ? (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-[#E2E8F0] text-slate-400 text-xs font-semibold rounded-lg opacity-50 cursor-not-allowed select-none"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Download Excel</span>
              </button>
            ) : (
              <a
                href={`/api/rating-engine/export?raceId=${currentRace?.id || "ALL"}`}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#CBD5E1] text-[#12306B] hover:bg-slate-50 text-xs font-semibold rounded-lg shadow-2xs transition cursor-pointer select-none"
              >
                <Download className="w-3.5 h-3.5 text-[#12306B]" />
                <span>Download Excel</span>
              </a>
            )}
            {currentHorses.length > 0 && (
              <span className="text-xs font-semibold text-slate-500">
                {currentHorses.length} runners
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[44px]">
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                  RACE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-center">
                  PLACE
                </th>
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
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  TIMING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  PREVIOUS RATING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  CHANGE
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  SUGGESTED RATING
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  FINAL RATING
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  JUSTIFICATION
                </th>
                <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569]">
                  REPORT REMARKS
                </th>
                <th className="px-4 py-3 text-[12px] font-medium uppercase tracking-wider text-[#475569] text-right">
                  ACTION
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {loading ? (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#12306B]" />
                      <span>Loading race horses...</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={14} className="px-5 py-12 text-center text-slate-500">
                    <p className="text-sm font-semibold text-red-600">{error}</p>
                    <button
                      type="button"
                      onClick={() => loadRaces()}
                      className="mt-3 px-3 py-1.5 bg-[#12306B] text-white text-xs font-semibold rounded-lg hover:bg-[#0E2452] transition cursor-pointer"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ) : currentHorses.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-5 py-12 text-center text-slate-500">
                    <p className="text-sm font-semibold text-slate-700">
                      {races.length === 0
                        ? "No current races. Upload a race file."
                        : "No horse data found for this race."}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {races.length === 0
                        ? "Upload a Current Race Excel file above to begin auto-rating."
                        : "Please select another race from the filters above."}
                    </p>
                  </td>
                </tr>
              ) : (
                currentHorses.map((h) => {
                  const isSelected = activeHorse?.id === h.id;
                  const isOverridden = workingDecisions[h.id]?.overridden || h.overridden;
                  const effectiveChange = workingDecisions[h.id]?.finalChange ?? h.finalChange ?? 0;
                  const effectiveRating = workingDecisions[h.id]?.finalRating ?? h.finalRating ?? "—";
                  const changeNum = Number(effectiveChange);
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
                      <td className="px-3 py-3 text-xs font-bold text-[#12306B] text-center whitespace-nowrap">
                        Race {h.raceNo}
                        <span className="block text-[10px] text-slate-400 font-normal">
                          {h.raceDate || ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm font-bold text-slate-700 text-center whitespace-nowrap tabular-nums">
                        {h.placing ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={isSelected ? "text-[#2563EB]" : ""}>
                            {h.horseName}
                          </span>
                          {h.cardNo && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              (Card #{h.cardNo})
                            </span>
                          )}
                          {h.ratingDiffersFromMaster && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
                              title={`Current race file rating (${h.raceCurrat ?? h.currentRating}) differs from Master Data rating (${h.masterRating})`}
                            >
                              Rating differs from master data
                            </span>
                          )}
                        </div>
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
                      <td className="px-3 py-3 text-sm text-slate-700 whitespace-nowrap tabular-nums">
                        {h.timing || "—"}
                      </td>
                      {/* Previous Rating */}
                      <td className="px-3 py-3 text-sm font-semibold text-slate-700 text-right whitespace-nowrap tabular-nums">
                        {h.currentRating ?? "—"}
                      </td>
                      {/* Change */}
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
                      {/* Suggested Rating */}
                      <td className="px-3 py-3 text-sm font-semibold text-slate-700 text-right whitespace-nowrap tabular-nums">
                        {h.suggestedRating ?? (h.startRating != null && h.recommendedChange != null ? h.startRating + h.recommendedChange : h.recommendedRating) ?? "—"}
                      </td>
                      {/* Final Rating */}
                      <td className="px-3 py-3 text-sm font-bold text-slate-900 text-right whitespace-nowrap tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{effectiveRating}</span>
                          {isOverridden && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                              Overridden
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Justification */}
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate" title={workingDecisions[h.id]?.overrideReason || h.overrideReason || h.reasonsExplanation}>
                        {workingDecisions[h.id]?.overrideReason || h.overrideReason || h.reasonsExplanation || "—"}
                      </td>
                      {/* Report Remarks */}
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {h.exception && h.exception !== "None" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px] max-w-[180px] truncate" title={h.exception}>
                            {h.exception}
                          </span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      {/* Action (Only Override for Handicapper; No keep option; No edit after override) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isHandicapper && !isRaceReviewed ? (
                          <div className="flex items-center justify-end">
                            {isOverridden ? (
                              <span
                                className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 cursor-default"
                                title="Rating already overridden by Handicapper (No edit option)"
                              >
                                Overridden
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOverrideModalHorse(h);
                                }}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-[#2563EB] hover:bg-blue-100 border border-blue-200 transition cursor-pointer"
                              >
                                Override
                              </button>
                            )}
                          </div>
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

      {/* 4. "Why this rating" & System Recommendation Steps Card */}
      {activeHorse && (() => {
        const primaryReasonText =
          (Array.isArray(activeHorse.reasons) && activeHorse.reasons[0]) ||
          activeHorse.reasonsExplanation ||
          whySentence;
        const parsed = parseJustification(primaryReasonText);

        return (
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 space-y-6">
            {/* Header & Rating Summary */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#EEF2F6]">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold text-slate-900">
                    Why this rating · {activeHorse.horseName}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-[#12306B] border border-blue-200">
                    Race {currentRace?.raceNo ?? activeHorse.raceNo ?? 1} · {currentRace?.category || activeHorse.raceCategory || "—"}
                  </span>
                  {activeHorse.overridden && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      Overridden by Handicapper
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {currentRace?.venue || "BNG"} · {activeHorse.raceDate} · {currentRace?.distance || activeHorse.distance || 1200}m · {currentHorses.length} runners
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="px-3.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-right">
                  <span className="text-[10px] text-slate-500 block font-semibold uppercase tracking-wider">
                    Recommended Change
                  </span>
                  <span className="text-base font-bold text-slate-800">
                    {activeHorse.recommendedChange > 0 ? `+${activeHorse.recommendedChange}` : (activeHorse.recommendedChange ?? 0)} pts
                  </span>
                </div>
                <div className="px-3.5 py-1.5 rounded-lg bg-[#EFF6FF] border border-blue-200 text-right">
                  <span className="text-[10px] text-[#2563EB] block font-semibold uppercase tracking-wider">
                    Suggested Rating
                  </span>
                  <span className="text-base font-bold text-[#12306B]">
                    {activeHorse.recommendedRating ?? "—"} pts
                  </span>
                </div>
                <div className="px-3.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-right">
                  <span className="text-[10px] text-emerald-700 block font-semibold uppercase tracking-wider">
                    Final Approved Rating
                  </span>
                  <span className="text-base font-bold text-emerald-900">
                    {activeHorse.finalRating ?? activeHorse.recommendedRating ?? "—"} pts
                  </span>
                </div>
              </div>
            </div>

            {/* Python Model Natural-Language Justification Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50/80 via-slate-50 to-white border border-blue-200/80 shadow-xs">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-[#12306B] uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#2563EB]" />
                <span>Python Backend Rating Engine Justification</span>
              </div>
              <p className="text-sm font-medium text-slate-800 leading-relaxed">
                {primaryReasonText}
              </p>
              {activeHorse.overridden && activeHorse.overrideReason && (
                <div className="mt-3 pt-3 border-t border-blue-200/60 text-xs flex items-start gap-2">
                  <span className="font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">
                    Handicapper Override:
                  </span>
                  <span className="text-slate-700 font-medium italic">
                    &ldquo;{activeHorse.overrideReason}&rdquo;
                  </span>
                </div>
              )}
            </div>

            {/* Structured System Recommendation Steps Grid */}
            <div>
              <div className="text-xs font-bold text-slate-800 mb-3 uppercase tracking-wider flex items-center justify-between">
                <span>System Recommendation Steps & Evaluated Features</span>
                <span className="text-[11px] font-normal text-slate-500">
                  BTC Hybrid Machine Learning Model (Baseline Rules + Layoff + Beaten Margin + Text Mining)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                {/* Tile 1: Race Classification */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">1. Race Classification</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-[#12306B] font-mono text-[10px] font-bold">
                      Class
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Category / Terms:</span>
                      <span className="font-semibold text-slate-900">{currentRace?.category || activeHorse.raceCategory || "—"} ({currentRace?.raceType || activeHorse.raceType || "Handicap"})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Distance:</span>
                      <span className="font-semibold text-slate-900">{currentRace?.distance || activeHorse.distance || 1200} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Track & Railing:</span>
                      <span className="font-semibold text-slate-900">{activeHorse.penetrometer ? `${activeHorse.penetrometer} cm` : "Normal"}, {activeHorse.railing ? "Fixed" : "Original"}</span>
                    </div>
                  </div>
                </div>

                {/* Tile 2: Eligibility & Prior Form */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">2. Eligibility & Form</span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-mono text-[10px] font-bold">
                      Form
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Career Runs:</span>
                      <span className="font-semibold text-slate-900">{activeHorse.previousRuns ?? 5} runs on record</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Layoff & Form Notes:</span>
                      <span className="font-semibold text-slate-900 max-w-[170px] truncate" title={parsed.numericalIndicators || "Standard schedule"}>
                        {parsed.numericalIndicators || "Standard schedule"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Eligibility Status:</span>
                      <span className="font-semibold text-emerald-700">Met criteria ({activeHorse.ratingStatus})</span>
                    </div>
                  </div>
                </div>

                {/* Tile 3: Reference Position & Margin */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">3. Finish & Margin</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px] font-bold">
                      Margin
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Placing in Field:</span>
                      <span className="font-semibold text-slate-900">
                        {activeHorse.placing ? `${activeHorse.placing}${getOrdinal(activeHorse.placing)} of ${currentHorses.length} runners` : "Unplaced"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Margin behind Winner:</span>
                      <span className="font-semibold text-slate-900 max-w-[170px] truncate" title={parsed.finishDetail || activeHorse.verdict || "—"}>
                        {activeHorse.verdict ? `${activeHorse.verdict} lengths` : (parsed.finishDetail || "—")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Recorded Timing:</span>
                      <span className="font-semibold text-slate-900">{activeHorse.timing || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* Tile 4: Weight Adjustment */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">4. Weight Adjustment</span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono text-[10px] font-bold">
                      Weight
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Weight Carried:</span>
                      <span className="font-semibold text-slate-900">{activeHorse.weightCarried ? `${activeHorse.weightCarried} kg` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Stall & Shoes:</span>
                      <span className="font-semibold text-slate-900">Gate {activeHorse.startGate ?? "—"} · {activeHorse.shoes || "A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Jockey / Trainer:</span>
                      <span className="font-semibold text-slate-900 max-w-[170px] truncate" title={`${activeHorse.jockey} / ${activeHorse.trainer}`}>
                        {activeHorse.jockey || "—"} / {activeHorse.trainer || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tile 5: Coefficient & Model Calculation */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">5. Coefficient & ML Calculation</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">
                      Algorithm
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">BTC Rule Baseline:</span>
                      <span className="font-semibold text-slate-900">
                        {parsed.ruleChange ? `${parsed.ruleChange} pts typical` : `${activeHorse.recommendedChange > 0 ? `+${activeHorse.recommendedChange}` : activeHorse.recommendedChange} pts`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Downgrade Likelihood:</span>
                      <span className="font-semibold text-slate-900">
                        {parsed.downgradeLikelihood || (activeHorse.placing && activeHorse.placing > 3 ? "Standard" : "N/A (Placed)")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Model Feature Adjustment:</span>
                      <span className="font-semibold text-slate-900">
                        {parsed.modelAdjustment ? `${parsed.modelAdjustment} pts` : "0.0 pts"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tile 6: Reports & Keywords Evaluation */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-200 transition">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900">6. Report Findings (12 Months)</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-mono text-[10px] font-bold">
                      Reports
                    </span>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Reports Checked:</span>
                      <span className="font-semibold text-slate-900">WET, Starter, Incident, Stipe</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">Observations / Keywords:</span>
                      <span className="font-semibold text-slate-800 block text-[11px] leading-tight" title={parsed.reportsSummary || activeHorse.exception || "No adverse remarks"}>
                        {parsed.reportsSummary || (activeHorse.exception && activeHorse.exception !== "None" ? activeHorse.exception : "No adverse remarks found")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 5. Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-[240px] right-0 bg-white/95 backdrop-blur-sm border-t border-[#E2E8F0] px-8 py-3.5 flex items-center justify-between z-30 shadow-md">
        <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
          <div className="bg-slate-100 px-3 py-1 rounded-md border border-slate-200 text-[#12306B] font-bold">
            {totalMatchingHorses} horses, {totalMatchingRaces} races, {totalMatchingDates} dates
          </div>
          <div>
            <span>{overriddenCount} horses overridden</span>
            <span className="mx-2 text-slate-300">·</span>
            <span>{keptCount} recommendations kept</span>
          </div>
        </div>

        {isHandicapperOrAdmin && (
          <div className="flex items-center gap-3">
            {races.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-600 font-semibold">Confirm Race:</span>
                <select
                  value={targetConfirmRaceId || (currentRace ? currentRace.id : "")}
                  onChange={(e) => setTargetConfirmRaceId(parseInt(e.target.value, 10))}
                  className="h-9 px-3 bg-white border border-[#CBD5E1] rounded-lg text-xs font-bold text-slate-800 cursor-pointer"
                >
                  {races.map((r) => (
                    <option key={r.id} value={r.id}>
                      Race {r.raceNo} ({r.runnersCount} horses)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => handleSubmitRace(targetConfirmRaceId || currentRace?.id)}
              disabled={isTargetRaceReviewed || submitting || races.length === 0}
              className={`h-10 px-5 text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer ${
                isTargetRaceReviewed
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
                {isTargetRaceReviewed
                  ? "Race Confirmed (Locked)"
                  : submitting
                  ? "Submitting..."
                  : `Confirm Race ${races.find(r => r.id === (targetConfirmRaceId || currentRace?.id))?.raceNo ?? ""}`}
              </span>
            </button>
          </div>
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
