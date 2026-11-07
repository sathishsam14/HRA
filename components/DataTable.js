"use client";

import React from "react";

export default function DataTable({
  columns = [],
  data = [],
  keyField = "id",
  selectable = false,
  selectedKeys = [],
  onSelectRow,
  onSelectAll,
  emptyMessage = "No records found",
  stickyHeader = true,
  className = "",
  tableClassName = "",
}) {
  const allSelected =
    data.length > 0 && selectedKeys.length === data.length;
  const someSelected =
    selectedKeys.length > 0 && selectedKeys.length < data.length;

  return (
    <div
      className={`w-full overflow-x-auto rounded-lg border border-[#E2E8F0] bg-white ${className}`}
    >
      <table
        className={`w-full text-left text-xs border-collapse ${tableClassName}`}
      >
        <thead
          className={`bg-[#F1F5F9] text-slate-700 font-semibold border-b border-[#E2E8F0] ${
            stickyHeader ? "sticky top-0 z-10" : ""
          }`}
        >
          <tr>
            {selectable && (
              <th className="w-10 px-3 py-3 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected;
                  }}
                  onChange={(e) => onSelectAll && onSelectAll(e.target.checked)}
                  aria-label="Select all rows"
                  className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
              </th>
            )}
            {columns.map((col, idx) => (
              <th
                key={col.key || idx}
                style={{ width: col.width }}
                className={`px-3.5 py-3 text-xs uppercase tracking-wider text-slate-600 font-semibold ${
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                    ? "text-center"
                    : "text-left"
                } ${col.headerClassName || ""}`}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E2E8F0]">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-8 text-center text-slate-400 text-xs"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => {
              const rowKey = row[keyField] ?? rowIdx;
              const isSelected = selectedKeys.includes(rowKey);

              return (
                <tr
                  key={rowKey}
                  onClick={() => selectable && onSelectRow && onSelectRow(rowKey, !isSelected)}
                  className={`transition-colors duration-150 ${
                    isSelected
                      ? "bg-[#EFF6FF] text-slate-900 font-medium"
                      : "hover:bg-slate-50/80 text-slate-800"
                  } ${selectable ? "cursor-pointer" : ""}`}
                >
                  {selectable && (
                    <td
                      className="px-3 py-2.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          onSelectRow && onSelectRow(rowKey, e.target.checked)
                        }
                        aria-label={`Select row ${rowKey}`}
                        className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((col, cIdx) => {
                    const value = row[col.dataIndex || col.key];
                    return (
                      <td
                        key={col.key || cIdx}
                        className={`px-3.5 py-2.5 whitespace-nowrap text-xs ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                            ? "text-center"
                            : "text-left"
                        } ${col.className || ""}`}
                      >
                        {col.render ? col.render(value, row, rowIdx) : (value ?? "-")}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
