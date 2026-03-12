import React from 'react';
import { MapPin, User } from 'lucide-react';

export default function TopStatus({ locationError, openProfile }) {
return (
    <div className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 right-4 z-20 flex justify-between items-start gap-3 pointer-events-none">
      
      {/* Left Block: Added min-w-0 and max-w-fit so it respects boundaries */}
      <div className="bg-white/95 backdrop-blur-xl p-3 rounded-2xl shadow-xl border border-slate-100 pointer-events-auto flex-1 min-w-0 max-w-fit">
        <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
          {/* shrink-0 on the icon prevents it from distorting */}
          <MapPin className="text-blue-500 shrink-0" size={16} /> 
          <span className="truncate">Fog World</span>
        </h3>
        {locationError && (
          <p className="text-[10px] text-red-500 mt-1 line-clamp-2 leading-tight break-words">
            {locationError}
          </p>
        )}
      </div>

      {/* Right Block: Added shrink-0 so the button NEVER gets squashed */}
      <div className="pointer-events-auto shrink-0">
        <button 
          onClick={openProfile} 
          className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-2xl shadow-xl transition-colors active:scale-95 flex items-center justify-center font-semibold"
        >
          <User size={18} />
        </button>
      </div>
      
    </div>
  );
}