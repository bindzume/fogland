import React from 'react';
import { Rocket, X, Search, Activity } from 'lucide-react';

export default function TeleportModal({ 
  showTeleportModal, 
  setShowTeleportModal, 
  teleportQuery, 
  setTeleportQuery, 
  executeTeleport, 
  isTeleporting 
}) {
  if (!showTeleportModal) return null;

  return (
    <div className="absolute inset-0 z-[70] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-3xl max-w-sm w-full shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Rocket className="text-purple-500" /> Jump to Location
          </h3>
          <button onClick={() => setShowTeleportModal(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <p className="text-sm text-slate-500 mb-4">
          Enter a city name or coordinates (Lat, Lng) to drop instantly.
        </p>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-3 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="e.g., Tokyo, or 35.68, 139.69"
            className="w-full bg-slate-100 border-none rounded-xl py-3 pl-10 pr-4 text-slate-800 focus:ring-2 focus:ring-purple-500 outline-none"
            value={teleportQuery}
            onChange={(e) => setTeleportQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && executeTeleport()}
            autoFocus
          />
        </div>

        <button
          onClick={executeTeleport}
          disabled={isTeleporting || !teleportQuery.trim()}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 transition-colors"
        >
          {isTeleporting ? <Activity className="animate-spin" size={20} /> : "Teleport"}
        </button>
      </div>
    </div>
  );
}