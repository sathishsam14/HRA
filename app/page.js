"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-3 border-[#12306B] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500">Redirecting to login...</p>
      </div>
    </div>
  );
}
