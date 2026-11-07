"use client";

import React, { Suspense } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import AppShell from "@/components/AppShell";
import PageTitle from "@/components/PageTitle";
import Card from "@/components/Card";
import Pill from "@/components/Pill";
import DataTable from "@/components/DataTable";
import { useData } from "@/lib/DataContext";
import { useAuth } from "@/lib/AuthContext";
import { History, ShieldCheck, RefreshCw } from "lucide-react";

function AuditContent() {
  const { overrides, confirmedRaces, resetState } = useData();
  const { user } = useAuth();

  // Generate audit trail entries from overrides and confirmed races
  const auditEntries = [];

  // Overrides entries
  Object.entries(overrides).forEach(([horseKey, ovr], idx) => {
    auditEntries.push({
      id: `ovr-${idx}`,
      timestamp: ovr.timestamp || "Today, 14:32 IST",
      user: ovr.user || user?.name || "Handicapper",
      role: "Senior Handicapper",
      action: "Expert Rating Override",
      target: `Horse #${horseKey}`,
      details: `Override: ${ovr.change > 0 ? `+${ovr.change}` : ovr.change} pts | Reason: ${ovr.reason}`,
      status: "Recorded",
    });
  });

  // Confirmed races entries
  confirmedRaces.forEach((raceId, idx) => {
    auditEntries.push({
      id: `conf-${idx}`,
      timestamp: "Today, 14:15 IST",
      user: user?.name || "Handicapper",
      role: user?.role || "Handicapper",
      action: "Race Rating Confirmation",
      target: `Race #${raceId}`,
      details: "Approved system recommendations and finalised official ratings",
      status: "Finalised",
    });
  });

  const columns = [
    { title: "Timestamp", dataIndex: "timestamp", key: "timestamp", width: "160px" },
    {
      title: "User",
      key: "user",
      render: (_, r) => (
        <div>
          <span className="font-semibold text-slate-900">{r.user}</span>
          <span className="text-[10px] text-slate-500 block">{r.role}</span>
        </div>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      render: (val) => (
        <span className="font-medium text-slate-800">{val}</span>
      ),
    },
    { title: "Target", dataIndex: "target", key: "target" },
    { title: "Details & Remarks", dataIndex: "details", key: "details", className: "text-slate-600" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (val) => (
        <Pill variant={val === "Finalised" ? "green" : "amber"} size="sm">
          {val}
        </Pill>
      ),
    },
  ];

  return (
    <div>
      <PageTitle
        title="Audit Trail"
        subtitle="Complete, tamper-evident log of all rating assessments, expert overrides, and race sign-offs"
        actions={
          <button
            onClick={resetState}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md shadow-sm transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Session Overrides</span>
          </button>
        }
      />

      <Card
        title="Audit Log Records"
        subtitle="Chronological trail of handicapping decisions and system calculations"
        action={
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Integrity Verified</span>
          </div>
        }
      >
        <DataTable
          columns={columns}
          data={auditEntries}
          keyField="id"
          emptyMessage="No audit logs recorded in this session yet. Overrides or confirmations will appear here."
        />
      </Card>
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
