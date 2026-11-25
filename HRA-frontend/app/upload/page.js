"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/AuthContext";
import SharedUploadCards from "@/components/SharedUploadCards";
import {
  FileText,
  Clock,
  User,
  RefreshCw,
  Database,
  ArrowRight,
} from "lucide-react";

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
  const isHandicapperOrAdmin = user?.role === "ADMIN" || user?.role === "HANDICAPPER";

  const [recentFiles, setRecentFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const fetchRecentFiles = useCallback(async () => {
    try {
      setLoadingFiles(true);
      const res = await fetch("/api/upload");
      if (res.ok) {
        const data = await res.json();
        setRecentFiles(data.files || []);
      }
    } catch (err) {
      console.warn("Failed to fetch recent files:", err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">File Ingestion & Master Upload</h1>
          <p className="text-xs text-slate-500 mt-1">
            Upload the Master History (BSM) to train the Python rating model, Current Race (BWM) to rate races, and optional race reports.
          </p>
        </div>
        <Link
          href="/rating-engine"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#12306B] text-white text-xs font-semibold rounded-lg hover:bg-[#0E2452] transition shadow-xs self-start sm:self-auto"
        >
          <span>Open Rating Engine</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Shared Upload Cards: All 6 fields in ONE single column */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] p-6 md:p-8">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Upload Documents</h2>
        <p className="text-xs text-slate-500 mb-6">
          Files are validated, archived, and passed directly to the Python rating engine.
        </p>
        <SharedUploadCards
          isHandicapperOrAdmin={isHandicapperOrAdmin}
          onUploadSuccess={() => fetchRecentFiles()}
        />
      </div>

      {/* Recent Uploads Table */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Upload History</h2>
            <p className="text-xs text-slate-500 mt-0.5">Audit log of files ingested into the system</p>
          </div>
          <button
            type="button"
            onClick={fetchRecentFiles}
            disabled={loadingFiles}
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0] h-[40px]">
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569]">FILE NAME</th>
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569]">TYPE</th>
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569]">SIZE</th>
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569]">UPLOADED AT (IST)</th>
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569]">UPLOADED BY</th>
                <th className="px-5 py-2.5 font-semibold uppercase tracking-wider text-[#475569] text-center">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F6]">
              {recentFiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    {loadingFiles ? "Loading recent uploads..." : "No recent uploads found."}
                  </td>
                </tr>
              ) : (
                recentFiles.map((f) => (
                  <tr key={f.id} className="h-[44px] hover:bg-[#F8FAFC] transition">
                    <td className="px-5 py-2.5 font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[200px]" title={f.name}>
                        {f.name}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-700 font-medium">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                        {f.fileType}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{formatFileSize(f.size)}</td>
                    <td className="px-5 py-2.5 text-slate-600 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{formatISTDateTime(f.uploadedAt)}</span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-700 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{f.user?.name || f.user?.email || "Automated Ingestion"}</span>
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          f.status === "PROCESSED"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-red-50 text-red-800 border-red-200"
                        }`}
                      >
                        {f.status}
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
        <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Loading Upload Portal...</div>}>
          <UploadContent />
        </Suspense>
      </AppShell>
    </ProtectedPage>
  );
}
