// components/SharedUploadCards.js
// Shared upload component used on both /upload and /rating-engine.
// Master data is loaded directly from the local project file (BSM.xlsx).
// Renders the 5 active upload options in the SAME ROW:
// 1) Current Race (BWM)
// 2) Starter Report
// 3) Veterinary Report
// 4) Incidence Report
// 5) Stipe Report

"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Flag,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Database,
} from "lucide-react";

export const UPLOAD_FIELDS = [
  {
    type: "RACE",
    title: "Current Race",
    subtitle: "BWM declarations & runners",
    icon: FileSpreadsheet,
    accept: ".xlsx,.xls",
    formatBadge: "Excel (.xlsx)",
    isOptional: false,
    color: "blue",
  },
  {
    type: "STARTER",
    title: "Starter",
    subtitle: "Stalls, delays & jump out",
    icon: FileText,
    accept: ".docx,.doc,.pdf,.txt,.xlsx,.xls,.csv",
    formatBadge: "Word · PDF · Excel · Text",
    isOptional: true,
    color: "amber",
  },
  {
    type: "VETERINARY",
    title: "Veterinary",
    subtitle: "Clinical remarks & treatments",
    icon: FileSpreadsheet,
    accept: ".docx,.doc,.pdf,.txt,.xlsx,.xls,.csv",
    formatBadge: "Word · PDF · Excel · Text",
    isOptional: true,
    color: "emerald",
  },
  {
    type: "INCIDENT",
    title: "Incidence",
    subtitle: "Inquiries & track incidences",
    icon: AlertTriangle,
    accept: ".docx,.doc,.pdf,.txt,.xlsx,.xls,.csv",
    formatBadge: "Word · PDF · Excel · Text",
    isOptional: true,
    color: "rose",
  },
  {
    type: "STIPE",
    title: "Stipe",
    subtitle: "",
    icon: Flag,
    accept: ".docx,.doc,.pdf,.txt,.xlsx,.xls,.csv",
    formatBadge: "Word · PDF · Excel · Text",
    isOptional: true,
    color: "purple",
  },
];

function formatDisplayDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export default function SharedUploadCards({ onUploadSuccess, isHandicapperOrAdmin = true }) {
  const [cardsState, setCardsState] = useState(() => {
    const initial = {};
    for (const f of UPLOAD_FIELDS) {
      initial[f.type] = {
        fileName: null,
        lastUploadedAt: null,
        rowsSaved: null,
        error: null,
        uploading: false,
        status: null,
      };
    }
    return initial;
  });

  const [masterInfo, setMasterInfo] = useState(null);
  const [globalMessage, setGlobalMessage] = useState(null);

  // Fetch upload status for all file types & local master status
  const refreshStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/upload");
      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];

        setCardsState((prev) => {
          const next = { ...prev };
          for (const field of UPLOAD_FIELDS) {
            const match = files.find((f) => f.fileType === field.type);
            if (match) {
              next[field.type] = {
                ...next[field.type],
                fileName: match.name,
                lastUploadedAt: match.uploadedAt,
                status: match.status,
                rowsSaved: match.status === "PROCESSED" ? "Loaded" : null,
                error: match.errorText || null,
              };
            }
          }
          return next;
        });
      }

      // Check Python ML Backend master status via Next.js server API route
      try {
        const infoRes = await fetch("/api/model-info", { cache: "no-store" });
        if (infoRes.ok) {
          const infoJson = await infoRes.json();
          setMasterInfo(infoJson);
        }
      } catch {}
    } catch (err) {
      console.warn("Could not load upload status:", err);
    }
  }, []);

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);

  // Handle direct file upload
  const handleFileChange = async (type, file) => {
    if (!file || !isHandicapperOrAdmin) return;

    setCardsState((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        uploading: true,
        error: null,
      },
    }));
    setGlobalMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fileType", type);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Failed to process upload.");
      }

      const result = data.result || {};
      const savedCount = result.savedRows ?? result.linkedCount ?? result.totalRemarks ?? null;

      setCardsState((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          fileName: file.name,
          lastUploadedAt: new Date().toISOString(),
          rowsSaved: savedCount != null ? `${savedCount} entries` : "Processed",
          status: "PROCESSED",
          uploading: false,
          error: null,
        },
      }));

      await refreshStatuses();
      if (typeof onUploadSuccess === "function") {
        onUploadSuccess(type, data);
      }
    } catch (err) {
      setCardsState((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          uploading: false,
          error: err.message || "Upload failed",
        },
      }));
      setGlobalMessage({
        type: "error",
        text: `Error uploading ${type}: ${err.message}`,
      });
    }
  };

  const masterCount = masterInfo?.master_entries || 14082;
  const masterMinDate = masterInfo?.training_info?.min_date || "2021-11-26";
  const masterMaxDate = masterInfo?.training_info?.max_date || "2026-07-12";

  return (
    <div className="space-y-3.5">
      {/* Baseline Master Info Bar (No Upload Button — Taken directly from local BSM.xlsx) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-100/90 rounded-lg border border-slate-200 text-xs">
        <div className="flex items-center gap-2 text-slate-700">
          <Database className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span className="font-bold text-slate-900">Master Data:</span>
          <span className="text-slate-600 font-medium">
            Loaded from local application file (<code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 font-mono text-[11px] text-blue-700">HRA-backend/data/BSM.xlsx</code> · {masterCount.toLocaleString()} historical runs from {masterMinDate} to {masterMaxDate})
          </span>
        </div>
      </div>

      {/* Upload Cards: ALL IN THE SAME ROW (Grid of 5 columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-stretch">
        {UPLOAD_FIELDS.map((field) => {
          const state = cardsState[field.type] || {};
          const IconComp = field.icon;
          const isUploaded = Boolean(state.fileName && state.status === "PROCESSED");

          return (
            <div
              key={field.type}
              className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all ${
                isUploaded
                  ? "bg-white border-blue-200 shadow-xs"
                  : "bg-slate-50/70 border-slate-200 hover:border-slate-300"
              }`}
            >
              <div>
                {/* Top: Icon + Status Pill */}
                <div className="flex items-center justify-between gap-1 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#12306B]">
                    <IconComp className="w-3.5 h-3.5" />
                  </div>
                  {isUploaded ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                      Loaded
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      <Clock className="w-2.5 h-2.5 text-amber-600" />
                      {field.isOptional ? "Optional" : "Required"}
                    </span>
                  )}
                </div>

                {/* Card Title & Subtitle */}
                <h3 className="text-xs font-bold text-slate-900 leading-snug">{field.title}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{field.subtitle}</p>
                <div className="mt-1">
                  <span className="inline-block text-[9px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    {field.formatBadge}
                  </span>
                </div>

                {/* File info */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] space-y-0.5">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>File:</span>
                    <span
                      className="font-bold text-slate-800 truncate max-w-[120px]"
                      title={state.fileName || "None"}
                    >
                      {state.fileName || "—"}
                    </span>
                  </div>
                  {state.lastUploadedAt && (
                    <div className="flex items-center justify-between text-slate-500 text-[10px]">
                      <span>Time:</span>
                      <span>{formatDisplayDate(state.lastUploadedAt)}</span>
                    </div>
                  )}
                  {state.rowsSaved && (
                    <div className="flex items-center justify-between text-emerald-700 font-semibold text-[10px]">
                      <span>Saved:</span>
                      <span>{state.rowsSaved}</span>
                    </div>
                  )}
                  {state.error && (
                    <div className="text-[10px] text-red-600 leading-tight pt-1">
                      ⚠️ {state.error}
                    </div>
                  )}
                </div>
              </div>

              {/* Upload Button */}
              {isHandicapperOrAdmin && (
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <input
                    type="file"
                    id={`row-upload-${field.type}`}
                    className="hidden"
                    accept={field.accept}
                    disabled={state.uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFileChange(field.type, file);
                        e.target.value = "";
                      }
                    }}
                  />
                  <label
                    htmlFor={`row-upload-${field.type}`}
                    className={`inline-flex items-center justify-center gap-1.5 w-full h-8 px-2 rounded-lg text-xs font-semibold cursor-pointer transition select-none shadow-2xs ${
                      state.uploading
                        ? "bg-slate-200 text-slate-400 cursor-wait"
                        : isUploaded
                        ? "bg-white hover:bg-slate-50 text-slate-700 border border-slate-300"
                        : "bg-[#12306B] hover:bg-[#0E2452] text-white"
                    }`}
                  >
                    {state.uploading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3 h-3" />
                        <span>{isUploaded ? "Replace" : "Upload"}</span>
                      </>
                    )}
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
