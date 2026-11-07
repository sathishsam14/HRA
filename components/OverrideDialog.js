"use client";

import React, { useState, useEffect } from "react";
import { SlidersHorizontal, X, Lock, RotateCcw, Check } from "lucide-react";

export default function OverrideDialog({
  isOpen,
  onClose,
  horse,
  race,
  user,
  onSave,
}) {
  const currentRating = Number(horse?.currentRating ?? 30);
  const recRating = Number(horse?.recommendedRating ?? currentRating);

  // Initial offset relative to recommended rating
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (horse) {
      if (horse.override && horse.finalRating !== undefined) {
        setOffset(Number(horse.finalRating) - recRating);
        setReason(horse.overrideReason || (horse.reason?.startsWith("Override: ") ? horse.reason.replace("Override: ", "") : ""));
      } else {
        setOffset(0);
        setReason("");
      }
      setError("");
    }
  }, [horse, recRating]);

  if (!isOpen || !horse) return null;

  const calculatedRating = recRating + offset;
  const totalShift = calculatedRating - currentRating;
  const algoChange = recRating - currentRating;

  const nowFormatted = (() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  })();

  const handleSave = () => {
    if (!reason.trim()) {
      setError("Please provide an override reason (mandatory).");
      return;
    }

    onSave({
      overrideRating: calculatedRating,
      finalRating: calculatedRating,
      finalChange: totalShift,
      change: totalShift,
      reason: reason.trim(),
      timestamp: new Date().toISOString(),
      user: user?.name || "Handicapper A",
    });
    onClose();
  };

  const handleResetToAlgo = () => {
    setOffset(0);
    setReason("");
    setError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-[480px] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                Override rating
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Manual steward discretion adjustment
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Horse summary card */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#12306B] text-white text-xs font-bold flex items-center justify-center">
                  #{horse.placing || "—"}
                </span>
                <span className="text-sm font-bold text-slate-900">
                  {horse.horseName}
                </span>
                <span className="text-xs text-slate-500">
                  · R{race?.raceNo || 5} {horse.placing === 1 ? "Winner" : ""}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#2563EB] border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
                Automatic Rec
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-md bg-white border border-slate-200">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Current rating
                </span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">
                  {currentRating} <span className="text-xs font-normal text-slate-500">pts</span>
                </span>
              </div>

              <div className="p-3 rounded-md bg-[#EFF6FF] border border-blue-200">
                <span className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider block">
                  Recommended rating
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-xl font-bold text-slate-900">
                    {recRating}
                  </span>
                  <span className="text-xs font-semibold text-[#2563EB]">
                    {algoChange >= 0 ? `+${algoChange}` : algoChange} algo
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Stepper: Final rating change */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-900">
                Final rating change
              </label>
              <span className="text-[11px] text-slate-500">
                Relative to algorithmic rec
              </span>
            </div>

            <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden h-11 bg-white">
              <button
                type="button"
                onClick={() => setOffset((prev) => prev - 1)}
                className="w-12 h-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200 border-r border-slate-200 text-lg font-bold transition-colors cursor-pointer"
              >
                −
              </button>
              <div className="flex-1 flex items-center justify-between px-4 text-xs font-medium text-slate-700">
                <span>
                  Offset:{" "}
                  <strong className="text-slate-900 text-sm font-bold">
                    {offset > 0 ? `+${offset}` : offset}
                  </strong>
                </span>
                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-800 text-xs font-semibold">
                  Calculated: {calculatedRating} pts
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOffset((prev) => prev + 1)}
                className="w-12 h-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200 border-l border-slate-200 text-lg font-bold transition-colors cursor-pointer"
              >
                +
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
              <span>
                New rating: {recRating} {offset >= 0 ? `+ ${offset}` : `− ${Math.abs(offset)}`} = <strong>{calculatedRating}</strong>
              </span>
              <span>
                Total shift from base:{" "}
                <strong className={totalShift > 0 ? "text-emerald-700" : totalShift < 0 ? "text-rose-700" : "text-slate-700"}>
                  {totalShift >= 0 ? `+${totalShift}` : totalShift} pts
                </strong>
              </span>
            </div>
          </div>

          {/* Override reason textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-900">
                Override reason <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-slate-500">
                Stewards review mandatory
              </span>
            </div>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              placeholder="e.g. Wide bend, carried out by #3 entering straight. Stewards and patrol film review confirm runner lost ~2 lengths without fault of jockey."
              className="w-full p-3 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent text-slate-900"
            />
            {error && (
              <p className="text-xs text-red-600 mt-1">{error}</p>
            )}
          </div>

          {/* User attribution block */}
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-[11px]">
              User: {user?.name || "Handicapper A"} · {nowFormatted} (added automatically)
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={handleResetToAlgo}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Algo</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Save override</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
