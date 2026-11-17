"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/AuthContext";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Clock,
  User,
} from "lucide-react";

const FILE_TYPES = [
  {
    value: "ACTIVE_HORSE",
    label: "Active Horse Performance Report (ACTIVE_HORSE)",
    accept: ".xlsx,.xls",
    hint: "Active Horse Previous Performance report: Horse blocks, starts, and historical runs (.xlsx)",
  },
  {
    value: "MASTER",
    label: "Horse Master Data (MASTER)",
    accept: ".xlsx,.xls",
    hint: "Master data of active horses: Horse Name, Sex Category (C&G or F&M), Current Rating, Trainer (.xlsx)",
  },
  {
    value: "HISTORY",
    label: "Previous Race History (HISTORY)",
    accept: ".xlsx,.xls",
    hint: "BWM-BSM Consolidated previous race history with 22 columns (.xlsx)",
  },
  {
    value: "RACE",
    label: "Current Race Data (RACE)",
    accept: ".xlsx,.xls",
    hint: "Current race file with BRD columns for performance calculation (.xlsx)",
  },
  {
    value: "STARTER",
    label: "Starter Report (STARTER)",
    accept: ".xlsx,.xls,.docx,.pdf",
    hint: "Starter observations with Race Date, Race No, Horse Name, Remark (.xlsx, .docx, .pdf)",
  },
  {
    value: "VETERINARY",
    label: "Veterinary Report (VETERINARY)",
    accept: ".xlsx,.xls,.docx,.pdf",
    hint: "Veterinary clinical remarks with Race Date, Race No, Horse Name, Remark (.xlsx, .docx, .pdf)",
  },
  {
    value: "INCIDENT",
    label: "Incident Report (INCIDENT)",
    accept: ".xlsx,.xls,.docx,.pdf",
    hint: "Steward incident reports with Race Date, Race No, Horse Name, Remark (.xlsx, .docx, .pdf)",
  },
  {
    value: "COEFFICIENT",
    label: "Dynamic Coefficients (COEFFICIENT)",
    accept: ".xlsx,.xls",
    hint: "Summary of P-Values & Coefficients: Race Category, Distance, Rating Change from Median Reference (.xlsx)",
  },
];

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatISTDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function UploadContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type");
  const [fileType, setFileType] = useState(() => {
    if (initialType && FILE_TYPES.some((f) => f.value === initialType)) {
      return initialType;
    }
    return "ACTIVE_HORSE";
  });

  useEffect(() => {
    const t = searchParams.get("type");
    if (t && FILE_TYPES.some((f) => f.value === t)) {
      setFileType(t);
    }
  }, [searchParams]);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorText, setErrorText] = useState(null);
  const [recentFiles, setRecentFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Fetch last 20 uploaded files
  const loadRecentFiles = useCallback(async () => {
    try {
      setLoadingFiles(true);
      const res = await fetch("/api/upload");
      if (res.ok) {
        const data = await res.json();
        setRecentFiles(data.files || []);
      }
    } catch (err) {
      console.error("Failed to load recent files:", err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "MANAGER" && user?.role !== "MANAGER") {
      loadRecentFiles();
    }
  }, [user, loadRecentFiles]);

  // Manager role is strictly prohibited from opening the upload screen
  if (user?.role === "MANAGER" || user?.role === "MANAGER") {
    return (
      <div className="max-w-2xl mx-auto mt-12 bg-white rounded-xl border border-red-200 p-8 shadow-sm text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto text-red-600 mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
        <p className="text-sm text-slate-600 mt-2">
          Your account has the <span className="font-semibold text-slate-800">MANAGER</span> role, which is read-only.
          File uploads and modifications are restricted to Administrators and Handicappers.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#12306B] text-white text-xs font-semibold rounded-lg hover:bg-[#0E2452] transition"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const activeTypeConfig = FILE_TYPES.find((t) => t.value === fileType);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      setErrorText(null);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorText("Please select a file to upload.");
      return;
    }

    setUploading(true);
    setErrorText(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("fileType", fileType);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.result) {
          setResult(data.result);
        }
        setErrorText(data.error || "File upload failed.");
      } else {
        setResult(data.result);
        // Refresh the recent files table
        loadRecentFiles();
      }
    } catch (err) {
      setErrorText(err.message || "Network error occurred while uploading file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Link href="/dashboard" className="hover:text-slate-800 transition flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
            </Link>
            <span>/</span>
            <span className="text-slate-700 font-medium">Data Ingestion</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Upload Race & Master Files
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest active horse performance reports, master horses, current race cards, or steward exception reports.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </Link>
      </div>

      {/* Upload Card */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 md:p-8">
        <form onSubmit={handleUpload} className="space-y-6 max-w-2xl">
          {/* 1. File Type Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              File Classification <span className="text-red-500">*</span>
            </label>
            <select
              value={fileType}
              onChange={(e) => {
                setFileType(e.target.value);
                setSelectedFile(null);
                setResult(null);
                setErrorText(null);
              }}
              className="w-full h-10 px-3 text-sm bg-white border border-[#CBD5E1] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#12306B] focus:border-transparent text-slate-800 font-medium"
            >
              {FILE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1.5">{activeTypeConfig?.hint}</p>
          </div>

          {/* 2. File Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Select Document <span className="text-red-500">*</span>
            </label>
            <div className="border-2 border-dashed border-[#CBD5E1] rounded-xl p-6 text-center hover:border-[#12306B] transition bg-slate-50/50">
              <input
                id="file-upload-input"
                type="file"
                accept={activeTypeConfig?.accept}
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="file-upload-input"
                className="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <div className="w-10 h-10 rounded-full bg-blue-50 text-[#12306B] flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-slate-800">
                  {selectedFile ? selectedFile.name : "Click to select a file"}
                </div>
                <div className="text-xs text-slate-500">
                  Supported formats: {activeTypeConfig?.accept.replace(/,/g, ", ")}
                </div>
              </label>
            </div>
            {selectedFile && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">
                <FileText className="w-4 h-4 text-slate-500" />
                <span className="font-medium text-slate-900">{selectedFile.name}</span>
                <span className="text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>

          {/* 3. Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#12306B] text-white text-xs font-semibold rounded-lg hover:bg-[#0E2452] transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Ingesting & Validating...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" /> Upload & Process File
                </>
              )}
            </button>
            {selectedFile && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setResult(null);
                  setErrorText(null);
                }}
                className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-800 transition"
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Error Alert */}
      {errorText && !result?.errors?.length && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-xs font-bold text-red-900">Upload Rejected</h3>
            <p className="text-xs text-red-700 mt-0.5">{errorText}</p>
          </div>
        </div>
      )}

      {/* Result Panel */}
      {result && (
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
          {/* Result Header Banner */}
          <div
            className={`px-6 py-4 flex items-center justify-between border-b ${
              result.success
                ? result.skipped
                  ? "bg-amber-50/70 border-amber-200"
                  : "bg-emerald-50/70 border-emerald-200"
                : "bg-red-50/70 border-red-200"
            }`}
          >
            <div className="flex items-center gap-3">
              {result.success ? (
                result.skipped ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                )
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <div>
                <h3
                  className={`text-sm font-bold ${
                    result.success
                      ? result.skipped
                        ? "text-amber-900"
                        : "text-emerald-900"
                      : "text-red-900"
                  }`}
                >
                  {result.success
                    ? result.skipped
                      ? "File Skipped (Already Uploaded)"
                      : "File Successfully Ingested"
                    : "Validation Failed – File Rejected"}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">{result.message}</p>
              </div>
            </div>

            {result.success && !result.skipped && (
              <Link
                href="/rating-engine"
                className="text-xs font-semibold text-[#12306B] hover:underline"
              >
                Go to Rating Engine →
              </Link>
            )}
          </div>

          {/* Metric Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
            <div className="p-4 text-center">
              <span className="text-xs text-slate-500 font-medium">Rows Saved</span>
              <div className="text-xl font-bold text-slate-900 mt-0.5">
                {result.savedRows ?? 0}
              </div>
            </div>
            <div className="p-4 text-center">
              <span className="text-xs text-slate-500 font-medium">Rows Rejected</span>
              <div className={`text-xl font-bold mt-0.5 ${result.rejectedRows > 0 ? "text-red-600" : "text-slate-900"}`}>
                {result.rejectedRows ?? 0}
              </div>
            </div>
            <div className="p-4 text-center">
              <span className="text-xs text-slate-500 font-medium">Unmatched Remarks</span>
              <div className={`text-xl font-bold mt-0.5 ${result.unmatched?.length > 0 ? "text-amber-600" : "text-slate-900"}`}>
                {result.unmatched?.length ?? 0}
              </div>
            </div>
          </div>

          {/* Validation Errors Table */}
          {result.errors && result.errors.length > 0 && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider">
                  Validation Error Details ({result.errors.length})
                </h4>
                <span className="text-[11px] text-slate-500">
                  All rows must be valid before any data is saved.
                </span>
              </div>
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-red-50 text-red-900 border-b border-red-200 font-semibold">
                      <th className="px-4 py-2.5 w-20">Row #</th>
                      <th className="px-4 py-2.5 w-44">Column / Field</th>
                      <th className="px-4 py-2.5">Reason for Rejection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {result.errors.map((err, idx) => (
                      <tr key={idx} className="hover:bg-red-50/40">
                        <td className="px-4 py-2 font-mono text-slate-600">{err.row}</td>
                        <td className="px-4 py-2 font-semibold text-slate-800">{err.column}</td>
                        <td className="px-4 py-2 text-red-700">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Unmatched Remarks Table */}
          {result.unmatched && result.unmatched.length > 0 && (
            <div className="p-6 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Unmatched Report Remarks ({result.unmatched.length})
                </h4>
                <span className="text-[11px] text-slate-500">
                  These remarks could not be linked to any matching race entry.
                </span>
              </div>
              <div className="border border-amber-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-amber-50 text-amber-900 border-b border-amber-200 font-semibold">
                      <th className="px-4 py-2.5 w-16">Row</th>
                      <th className="px-4 py-2.5 w-28">Race Date</th>
                      <th className="px-4 py-2.5 w-20">Race #</th>
                      <th className="px-4 py-2.5 w-36">Horse Name</th>
                      <th className="px-4 py-2.5">Remark</th>
                      <th className="px-4 py-2.5 text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {result.unmatched.map((item, idx) => (
                      <tr key={idx} className="hover:bg-amber-50/40">
                        <td className="px-4 py-2 font-mono text-slate-600">{item.row}</td>
                        <td className="px-4 py-2 text-slate-700">{item.raceDate}</td>
                        <td className="px-4 py-2 text-slate-700">Race {item.raceNo}</td>
                        <td className="px-4 py-2 font-semibold text-slate-800">{item.horseName}</td>
                        <td className="px-4 py-2 text-slate-700">{item.remark}</td>
                        <td className="px-4 py-2 text-amber-700 font-medium">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Under It: Last 20 Uploaded Files with Status */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Recent File Ingestion Log (Last 20 Files)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Audit record of uploaded master data, race sheets, and steward reports.
            </p>
          </div>
          <button
            onClick={loadRecentFiles}
            disabled={loadingFiles}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#F8FAFC] text-slate-600 font-semibold border-b border-[#E2E8F0]">
              <tr>
                <th className="px-6 py-3">File Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Uploaded By</th>
                <th className="px-4 py-3">Timestamp (IST)</th>
                <th className="px-6 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {recentFiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                    {loadingFiles ? "Loading recent uploads..." : "No files recorded yet."}
                  </td>
                </tr>
              ) : (
                recentFiles.map((file) => (
                  <tr key={file.id} className="hover:bg-slate-50/60 transition">
                    <td className="px-6 py-3.5 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="truncate max-w-xs">{file.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-slate-100 text-slate-700 border border-slate-200">
                        {file.fileType}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 font-mono">
                      {formatFileSize(file.size)}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{file.user?.name || "System / Auto"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 font-mono">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatISTDateTime(file.uploadedAt)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          file.status === "PROCESSED"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : file.status === "SKIPPED"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {file.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <ProtectedPage>
      <AppShell>
        <Suspense
          fallback={
            <div className="p-8 text-center text-xs text-slate-400">
              Loading upload page...
            </div>
          }
        >
          <UploadContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
