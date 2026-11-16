"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { User, Lock, ArrowRight, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bgImageError, setBgImageError] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);

    try {
      const res = await login(username, password);
      if (res.success) {
        router.push("/dashboard");
      } else {
        setError(res.error || "Invalid email or password");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F8FAFC]">
      {/* Left Half: Race Photo with Navy Overlay (45% opacity) */}
      <div
        className="lg:w-1/2 relative min-h-[420px] lg:min-h-screen flex flex-col justify-end p-8 sm:p-12 lg:p-16 overflow-hidden bg-[#12306B]"
        style={{
          backgroundImage: bgImageError ? "none" : "url('/login-bg.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Hidden image element to detect load error gracefully */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/login-bg.png"
          alt=""
          className="hidden"
          onError={() => setBgImageError(true)}
        />

        {/* Navy #12306B overlay at 45% opacity */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(18, 48, 107, 0.45)" }}
        />

        {/* Bottom Text Content */}
        <div className="relative z-10 text-white max-w-xl">
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-tight mb-2">
            Horse Rating Automation
          </h1>
          <p className="text-base sm:text-lg text-white/80 font-normal">
            Recommend. Review. Record.
          </p>
        </div>
      </div>

      {/* Right Half: BTC Logo, Sign-in Card, and Footer */}
      <div className="lg:w-1/2 flex flex-col justify-between items-center min-h-screen py-10 px-6 sm:px-12 bg-[#F8FAFC]">
        {/* Top: BTC Logo */}
        <div className="flex flex-col items-center pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Bangalore Turf Club"
            className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-sm"
          />
          <span className="text-xs font-bold text-slate-800 tracking-wider uppercase mt-2.5">
            Bangalore Turf Club
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            Racing Department
          </span>
        </div>

        {/* Center: Sign In Card */}
        <div className="w-full max-w-[420px] my-auto py-6">
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(15,23,42,0.06)] p-7 sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Sign in
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter your credentials to access the system
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username / Email Input */}
              <div>
                <label
                  htmlFor="username"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Email or Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="e.g. admin@btc.com or admin"
                    className="w-full h-10 pl-9 pr-3 text-xs border border-[#CBD5E1] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent bg-white text-slate-900"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="Enter password"
                    className="w-full h-10 pl-9 pr-10 text-xs border border-[#CBD5E1] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent bg-white text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Inline Error Message */}
              {error && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              {/* Primary Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 mt-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>{submitting ? "Signing in..." : "Sign in"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-4 text-center">
              <a
                href="#contact-admin"
                onClick={(e) => {
                  e.preventDefault();
                  alert("Please contact the BTC IT Administrator for account assistance.");
                }}
                className="text-xs text-[#2563EB] hover:underline"
              >
                Forgot password?
              </a>
            </div>
          </div>
        </div>

        {/* Bottom: Copyright & Version */}
        <div className="text-xs text-slate-400 text-center pb-2">
          © 2026 BTC Racing Department · Version 1.0
        </div>
      </div>
    </div>
  );
}
