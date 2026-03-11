import React from 'react';
import { Search, Rocket, Book, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export default function BottomControls({
  setShowTeleportModal,
  showOnlyWiki,
  setShowOnlyWiki,
  manualMove,
  STEP_SIZE,
  debugMode,
  onSearchLandmarks,
  isSearching
}) {
  return (
    <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-4 right-4 z-20 flex justify-between items-end pointer-events-none">
      <div className="pointer-events-auto bg-white/95 backdrop-blur-xl p-3 rounded-3xl shadow-2xl border border-slate-100 flex flex-col gap-2">
        <button onClick={onSearchLandmarks} disabled={isSearching} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold transition-all active:scale-95 ${isSearching ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' : 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'}`}>
          <Search size={18} className={isSearching ? "animate-spin" : ""} /> {isSearching ? "Searching…" : "Search Area"}
        </button>

        {/* ONLY SHOW IN DEBUG MODE */}
        {debugMode && (
          <button onClick={() => setShowTeleportModal(true)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all active:scale-95 bg-purple-100 text-purple-700 hover:bg-purple-200">
            <Rocket size={18} /> Teleport
          </button>
        )}

        <button onClick={() => setShowOnlyWiki(!showOnlyWiki)} className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all active:scale-95 ${showOnlyWiki ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Book size={18} /> {showOnlyWiki ? "Wiki Only" : "All Sites"}
        </button>
      </div>

      {/* ONLY SHOW D-PAD IN DEBUG MODE */}
      {debugMode && (
        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl p-3 rounded-3xl shadow-2xl border border-slate-100">
          <div className="grid grid-cols-3 gap-2">
            <div />
            <button onClick={() => manualMove(STEP_SIZE, 0)} className="bg-slate-100 p-3 rounded-xl flex items-center justify-center active:scale-90"><ChevronUp size={20} className="text-slate-700" /></button>
            <div />
            <button onClick={() => manualMove(0, -STEP_SIZE)} className="bg-slate-100 p-3 rounded-xl flex items-center justify-center active:scale-90"><ChevronLeft size={20} className="text-slate-700" /></button>
            <button onClick={() => manualMove(-STEP_SIZE, 0)} className="bg-slate-100 p-3 rounded-xl flex items-center justify-center active:scale-90"><ChevronDown size={20} className="text-slate-700" /></button>
            <button onClick={() => manualMove(0, STEP_SIZE)} className="bg-slate-100 p-3 rounded-xl flex items-center justify-center active:scale-90"><ChevronRight size={20} className="text-slate-700" /></button>
          </div>
        </div>
      )}
    </div>
  );
}