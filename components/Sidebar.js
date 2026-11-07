"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Cpu,
  BarChart3,
  History,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import Pill from "@/components/Pill";

const MENU_ITEMS = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Rating Engine",
    href: "/rating-engine",
    icon: Cpu,
  },
  {
    name: "MIS Report",
    href: "/mis",
    icon: BarChart3,
  },
  {
    name: "Audit Trail",
    href: "/audit",
    icon: History,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="w-[240px] flex-shrink-0 bg-[#12306B] text-white flex flex-col min-h-screen z-30">
      {/* Top Logo Section */}
      <div className="pt-6 px-6 pb-6 flex flex-col items-center border-b border-white/10">
        <div className="w-12 h-12 rounded-lg bg-white p-1.5 flex items-center justify-center shadow-xs">
          <img
            src="/logo.png"
            alt="Bangalore Turf Club"
            className="w-full h-full object-contain"
          />
        </div>
        <span className="text-[11px] font-semibold text-white/90 tracking-widest uppercase mt-3 text-center">
          HORSE RATING AUTOMATION
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3.5 px-6 h-[44px] text-sm font-normal transition-colors ${
                isActive
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2563EB]" />
              )}
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Block at bottom */}
      <div className="p-4 border-t border-white/10 bg-[#0E2554]/40">
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-semibold text-white truncate">
              {user?.name || "David Sterling"}
            </div>
            <div className="text-[11px] text-white/60 truncate">
              {user?.email || `${user?.username || "david.s"}@btc.in`}
            </div>
          </div>
          <Pill
            variant={user?.role === "Admin" ? "navy" : "grey"}
            size="sm"
            className="!text-[10px] !px-2 !py-0.5 border-white/20 bg-white/15 text-white"
          >
            {user?.role || "Admin"}
          </Pill>
        </div>

        <button
          onClick={handleLogout}
          className="w-full h-[36px] mt-2 flex items-center justify-center gap-2 rounded border border-white/20 text-xs text-white/90 hover:bg-white/10 transition-colors font-medium cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
