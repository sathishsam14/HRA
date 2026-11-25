import React from "react";

export default function PageTitle({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className = "",
}) {
  return (
    <div className={`mb-6 ${className}`}>
      {breadcrumbs && (
        <nav className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
          {breadcrumbs}
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}
