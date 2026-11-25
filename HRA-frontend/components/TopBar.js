"use client";

import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { Calendar, User } from "lucide-react";

export default function TopBar() {
  const { user } = useAuth();

  // Format date nicely e.g. "Saturday, 07 Nov 2026"
  const formattedDate = (() => {
    try {
      const d = new Date("2026-11-07");
      return d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "Saturday, 07 Nov 2026";
    }
  })();

  return (
    <header className="h-16 flex-shrink-0 bg-white border-b border-[#E2E8F0] px-8 flex items-center justify-between z-20">
      {/* Left: Department branding with Logo */}
      <div className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt="Bangalore Turf Club"
          className="w-7 h-7 object-contain"
        />
        <span className="text-sm font-semibold text-slate-900 tracking-tight">
          Bangalore Turf Club · Racing Department
        </span>
      </div>

      {/* Right: Date, Season Pill, and User Avatar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          <span>{formattedDate}</span>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
          <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
          <span>Bangalore Turf Club · Winter Season 2026</span>
        </div>

        <div className="w-8 h-8 rounded-full bg-[#12306B] text-white flex items-center justify-center font-bold text-xs shadow-xs">
          <User className="w-4 h-4 text-white" />
        </div>
      </div>
    </header>
  );
}
