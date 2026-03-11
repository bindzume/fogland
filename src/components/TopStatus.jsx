import React from 'react';
import { MapPin, User } from 'lucide-react';

export default function TopStatus({ locationError, openProfile }) {
  return (
    <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
      <div className="bg-white/95 backdrop-blur-xl p-3 rounded-2xl shadow-xl border border-slate-100 pointer-events-auto">
        <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
          <MapPin className="text-blue-500" size={16} /> Fog World
        </h3>
        {locationError && <p className="text-[10px] text-red-500 mt-1">{locationError}</p>}
      </div>
      <div className="pointer-events-auto">
        <button 
          onClick={openProfile} 
          className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-2xl shadow-xl transition-colors active:scale-95 flex items-center gap-2 font-semibold"
        >
          <User size={18} />
        </button>
      </div>
    </div>
  );
}