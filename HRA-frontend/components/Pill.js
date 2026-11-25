import React from "react";

const VARIANTS = {
  green: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  amber: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  red: "bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]",
  grey: "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]",
  navy: "bg-[#12306B] text-white border-[#12306B]",
  blue: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
};

export default function Pill({
  children,
  variant = "grey",
  size = "md",
  className = "",
}) {
  const variantClass = VARIANTS[variant] || VARIANTS.grey;
  const sizeClass =
    size === "sm"
      ? "text-xs px-2 py-0.5"
      : size === "lg"
      ? "text-sm px-3 py-1 font-semibold"
      : "text-xs px-2.5 py-1 font-medium";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${variantClass} ${sizeClass} ${className}`}
    >
      {children}
    </span>
  );
}
