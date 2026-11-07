import React from "react";

export default function Card({
  children,
  title,
  subtitle,
  action,
  className = "",
  bodyClassName = "",
  headerClassName = "",
}) {
  return (
    <div
      className={`bg-white rounded-lg border border-[#E2E8F0] shadow-sm overflow-hidden ${className}`}
    >
      {(title || subtitle || action) && (
        <div
          className={`px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between ${headerClassName}`}
        >
          <div>
            {title && (
              <h3 className="text-base font-semibold text-slate-900 leading-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
