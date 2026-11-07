"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import rawData from "@/data/sample-data.json";

const DataContext = createContext(null);

const OVERRIDES_KEY = "hra_overrides";
const CONFIRMED_KEY = "hra_confirmed_races";
const AUDIT_KEY = "hra_audit_trail";
const FILES_KEY = "hra_files_state";

export function DataProvider({ children }) {
  const [overrides, setOverrides] = useState({});
  const [confirmedRaces, setConfirmedRaces] = useState([]);
  const [auditList, setAuditList] = useState(rawData.audit || []);
  const [filesState, setFilesState] = useState(rawData.filesByRace || {});
  const [mounted, setMounted] = useState(false);

  // Load persisted state from sessionStorage
  useEffect(() => {
    try {
      const storedOverrides = sessionStorage.getItem(OVERRIDES_KEY);
      if (storedOverrides) {
        setOverrides(JSON.parse(storedOverrides));
      }
      const storedConfirmed = sessionStorage.getItem(CONFIRMED_KEY);
      if (storedConfirmed) {
        setConfirmedRaces(JSON.parse(storedConfirmed));
      }
      const storedAudit = sessionStorage.getItem(AUDIT_KEY);
      if (storedAudit) {
        setAuditList(JSON.parse(storedAudit));
      }
      const storedFiles = sessionStorage.getItem(FILES_KEY);
      if (storedFiles) {
        setFilesState(JSON.parse(storedFiles));
      }
    } catch (err) {
      console.error("Failed to load working state from sessionStorage", err);
    } finally {
      setMounted(true);
    }
  }, []);

  // Build race map to merge race fields into horses
  const rawRaces = rawData.races || [];
  const rawHorses = rawData.horses || [];

  const raceMap = new Map(rawRaces.map((r) => [r.id, r]));

  // Merge race fields and sessionStorage overrides into horses
  const horses = rawHorses.map((h, idx) => {
    const race = raceMap.get(h.raceId) || {};
    const horseKey = h.id || `${h.raceId}-${h.horseName || idx}`;
    const userOverride = overrides[horseKey];

    const isOverridden = userOverride ? true : !!h.override;
    const finalRating = userOverride
      ? Number(userOverride.finalRating ?? userOverride.overrideRating)
      : h.finalRating;
    const finalChange = userOverride
      ? Number(userOverride.finalChange ?? userOverride.change)
      : h.finalChange;
    const reason = userOverride
      ? `Override: ${userOverride.reason}`
      : h.reason;
    const overrideReason = userOverride
      ? userOverride.reason
      : h.overrideReason;

    return {
      ...h,
      id: horseKey,
      venue: h.venue ?? race.venue,
      date: h.date ?? race.date,
      season: h.season ?? race.season,
      type: h.type ?? race.type,
      category: h.category ?? race.category,
      raceNo: h.raceNo ?? race.raceNo,
      cardNo: h.cardNo ?? race.cardNo,
      distance: h.distance ?? race.distance,
      runners: h.runners ?? race.runners,
      raceStatus: race.status,
      override: isOverridden,
      overrideRating: userOverride ? finalRating : h.overrideRating,
      finalRating,
      finalChange,
      reason,
      overrideReason,
    };
  });

  // Races with confirmed status update
  const races = rawRaces.map((r) => {
    const isConfirmed = confirmedRaces.includes(r.id);
    return {
      ...r,
      status: isConfirmed ? "Reviewed" : r.status,
    };
  });

  const saveOverride = (horseKey, overrideObj, horseData, user) => {
    // Only Handicapper can override
    if (user?.role !== "Handicapper") {
      console.warn("Unauthorized override attempt. Only Handicapper can override.");
      return;
    }
    // 1. Update overrides map
    setOverrides((prev) => {
      const next = { ...prev, [horseKey]: overrideObj };
      try {
        sessionStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Failed to save override", e);
      }
      return next;
    });

    // 2. Add audit entry at the top of the list
    const newAuditEntry = {
      timestamp: overrideObj.timestamp || new Date().toISOString(),
      user: user?.name || "Handicapper A",
      role: user?.role || "Handicapper",
      raceId: horseData?.raceId || "R5",
      raceDate: horseData?.date || "2026-11-07",
      raceNo: horseData?.raceNo || 5,
      horseName: horseData?.horseName || "Horse",
      recommendedRating: horseData?.recommendedRating ?? 50,
      finalRating: overrideObj.finalRating,
      change: overrideObj.finalChange,
      reason: overrideObj.reason,
      trace: horseData?.trace || {},
    };

    setAuditList((prev) => {
      const updated = [newAuditEntry, ...prev];
      try {
        sessionStorage.setItem(AUDIT_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save audit entry", e);
      }
      return updated;
    });
  };

  const removeOverride = (horseKey) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[horseKey];
      try {
        sessionStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Failed to remove override", e);
      }
      return next;
    });
  };

  const confirmRace = (raceId) => {
    setConfirmedRaces((prev) => {
      if (prev.includes(raceId)) return prev;
      const next = [...prev, raceId];
      try {
        sessionStorage.setItem(CONFIRMED_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Failed to confirm race", e);
      }
      return next;
    });
  };

  const updateFileStatus = (raceId, fileIndex, fileName) => {
    setFilesState((prev) => {
      const baseFiles = prev[raceId] || rawData.filesByRace?.[raceId] || [];
      const raceFiles = [...baseFiles];
      if (raceFiles[fileIndex]) {
        raceFiles[fileIndex] = {
          ...raceFiles[fileIndex],
          status: "Uploaded",
          detail: fileName,
        };
      }
      const next = { ...prev, [raceId]: raceFiles };
      try {
        sessionStorage.setItem(FILES_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Failed to update file status", e);
      }
      return next;
    });
  };

  const removeFileStatus = (raceId, fileIndex) => {
    setFilesState((prev) => {
      const baseFiles = prev[raceId] || rawData.filesByRace?.[raceId] || [];
      const raceFiles = [...baseFiles];
      if (raceFiles[fileIndex]) {
        raceFiles[fileIndex] = {
          ...raceFiles[fileIndex],
          status: "Not uploaded",
          detail: "",
        };
      }
      const next = { ...prev, [raceId]: raceFiles };
      try {
        sessionStorage.setItem(FILES_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("Failed to remove file status", e);
      }
      return next;
    });
  };

  const resetState = () => {
    setOverrides({});
    setConfirmedRaces([]);
    setAuditList(rawData.audit || []);
    setFilesState(rawData.filesByRace || {});
    try {
      sessionStorage.removeItem(OVERRIDES_KEY);
      sessionStorage.removeItem(CONFIRMED_KEY);
      sessionStorage.removeItem(AUDIT_KEY);
      sessionStorage.removeItem(FILES_KEY);
    } catch (e) {
      console.error("Failed to reset working state", e);
    }
  };

  return (
    <DataContext.Provider
      value={{
        races,
        horses,
        audit: auditList,
        dashboard: rawData.dashboard || {},
        users: rawData.users || [],
        today: rawData.today || "2026-11-07",
        meta: rawData.meta || {},
        master: rawData.master || [],
        history: rawData.history || [],
        filesByRace: filesState,
        overrides,
        confirmedRaces,
        mounted,
        saveOverride,
        removeOverride,
        confirmRace,
        updateFileStatus,
        removeFileStatus,
        resetState,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
}
