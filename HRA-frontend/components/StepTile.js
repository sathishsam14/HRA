import React from "react";

export default function StepTile({
  stepNumber,
  title,
  subtitle,
  status = "pending", // "completed", "active", "pending"
  onClick,
  className = "",
}) {
  const isCompleted = status === "completed";
  const isActive = status === "active";

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center gap-3 p-3.5 rounded-lg border transition-all ${
        isActive
          ? "border-[#2563EB] bg-[#EFF6FF] text-slate-900 shadow-sm"
          : isCompleted
          ? "border-emerald-200 bg-emerald-50/50 text-slate-800"
          : "border-[#E2E8F0] bg-white text-slate-600 hover:bg-slate-50"
      } ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          isActive
            ? "bg-[#2563EB] text-white"
            : isCompleted
            ? "bg-emerald-600 text-white"
            : "bg-slate-200 text-slate-600"
        }`}
      >
        {isCompleted ? "✓" : stepNumber}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold leading-tight truncate">
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] text-slate-500 leading-tight truncate mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
