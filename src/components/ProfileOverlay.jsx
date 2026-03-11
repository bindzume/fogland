import React, { useState } from 'react';
import { User, X, Globe, Activity, Backpack, Star, Trees, Download, Upload, Trash2, Settings, Bug, Plus, Tag, MapPin } from 'lucide-react';

export default function ProfileOverlay({
  showProfile,
  setShowProfile,
  handleImport,
  handleExport,
  fileInputRef,
  showConfirmWipe,
  setShowConfirmWipe,
  executeClearData,
  activeTab,
  setActiveTab,
  stats,
  geoData,
  regionalAreas,
  groupedBag,
  visibleCollectedCount,
  showOnlyWiki,
  debugMode,
  setDebugMode,
  draftOsmTags, // NEW: Using draft state instead of active state
  toggleOsmTag,
  addOsmTag,
  saveOsmTags, // NEW: Save function
  resetOsmTags // NEW: Reset function
}) {
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  if (!showProfile) return null;

  const handleAddNewTag = (e) => {
    e.preventDefault();
    if (addOsmTag(newTagKey, newTagValue)) {
      setNewTagKey('');
      setNewTagValue('');
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-slate-900/95 backdrop-blur-md overflow-y-auto">
      <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />

      {/* CONFIRMATION MODAL */}
      {showConfirmWipe && (
        <div className="fixed inset-0 z-[60] bg-slate-900/90 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-sm w-full border border-slate-700 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Wipe Data?</h3>
            <p className="text-slate-300 mb-6">Are you sure you want to wipe all explored data and empty your bag? This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirmWipe(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={executeClearData} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Yes, Wipe Data</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto p-6 text-slate-100 pb-20">
        
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6 pt-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <User className="text-blue-400" /> Profile
          </h2>
          <div className="flex gap-4 items-center">
            <button onClick={handleExport} title="Export Save" className="p-2 text-slate-400 hover:text-blue-400 transition-colors"><Download size={20} /></button>
            <button onClick={() => fileInputRef.current?.click()} title="Import Save" className="p-2 text-slate-400 hover:text-green-400 transition-colors"><Upload size={20} /></button>
            <button onClick={() => setShowConfirmWipe(true)} title="Wipe Data" className="p-2 text-slate-400 hover:text-red-400 transition-colors"><Trash2 size={20} /></button>
            <div className="w-px h-6 bg-slate-700 mx-1"></div>
            <button onClick={() => setShowProfile(false)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors"><X size={20} /></button>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-2 mb-6 bg-slate-800 p-1 rounded-xl">
          <button onClick={() => setActiveTab('stats')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${activeTab === 'stats' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
            <Activity size={16} /> Stats
          </button>
          <button onClick={() => setActiveTab('bag')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${activeTab === 'bag' ? 'bg-yellow-500 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}>
            <Backpack size={16} /> Bag ({visibleCollectedCount})
          </button>
          <button onClick={() => setActiveTab('settings')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${activeTab === 'settings' ? 'bg-slate-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
            <Settings size={16} /> Settings
          </button>
        </div>

        {/* TAB: STATS */}
        {activeTab === 'stats' && (
           <div className="space-y-6">
           <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700">
             <div className="flex items-center gap-3 mb-4">
               <Globe className="text-green-400" size={24} /> 
               <h3 className="text-xl font-semibold">World Overview</h3>
             </div>
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-900/50 p-4 rounded-2xl">
                 <div className="text-sm text-slate-400 mb-1">Total Distance</div>
                 <div className="text-xl font-mono font-bold text-white">
                   {stats.distance < 1 ? (stats.distance * 1000).toFixed(0) + ' m' : stats.distance.toFixed(2) + ' km'}
                 </div>
               </div>
               <div className="bg-slate-900/50 p-4 rounded-2xl">
                 <div className="text-sm text-slate-400 mb-1">Cleared Area</div>
                 <div className="text-xl font-mono font-bold text-blue-400">
                   {stats.areaKm < 1 ? (stats.areaKm * 1000000).toFixed(0) + ' m²' : stats.areaKm.toFixed(3) + ' km²'}
                 </div>
               </div>
             </div>
           </div>

           <h3 className="text-lg font-semibold px-2 flex items-center gap-2">
             <MapPin className="text-purple-400" /> Regional Data
           </h3>
           
           {!geoData ? (
             <div className="text-center p-8 text-slate-500 bg-slate-800/50 rounded-3xl border border-slate-700 border-dashed">
               <Activity className="animate-spin mx-auto mb-3 opacity-50" size={32} /> Scanning topography...
             </div>
           ) : (
             <div className="space-y-4">
               <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                 <div className="flex justify-between mb-2">
                   <div>
                     <div className="text-xs text-slate-500 uppercase">Country</div>
                     <div className="text-lg font-semibold">{geoData.country}</div>
                   </div>
                 </div>
                 {regionalAreas.country && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.country) * 100).toFixed(6)}% Unlocked</div>}
               </div>
               <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                 <div className="flex justify-between mb-2">
                   <div>
                     <div className="text-xs text-slate-500 uppercase">State</div>
                     <div className="text-lg font-semibold">{geoData.state}</div>
                   </div>
                 </div>
                 {regionalAreas.state && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.state) * 100).toFixed(6)}% Unlocked</div>}
               </div>
               <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                 <div className="flex justify-between mb-2">
                   <div>
                     <div className="text-xs text-slate-500 uppercase">City</div>
                     <div className="text-lg font-semibold">{geoData.city}</div>
                   </div>
                 </div>
                 {regionalAreas.local && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.local) * 100).toFixed(6)}% Unlocked</div>}
               </div>
             </div>
           )}
         </div>
        )}

        {/* TAB: BAG */}
        {activeTab === 'bag' && (
          <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700 min-h-[400px]">
            {visibleCollectedCount === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 pt-10">
                <Backpack size={48} className="mb-4 opacity-50" />
                <p className="text-center">{showOnlyWiki ? "No Wikipedia sites found yet." : "Your bag is empty."}</p>
                <p className="text-sm text-center mt-2">Explore the map to find glowing ⭐ landmarks hiding in the fog!</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedBag).map(([country, states]) => (
                  <div key={country} className="border-l-4 border-yellow-500 pl-4 py-1">
                    <h3 className="text-xl font-bold text-yellow-400 mb-3 flex items-center gap-2"><Globe size={18} /> {country}</h3>

                    {Object.entries(states).map(([state, cities]) => (
                      <div key={state} className="ml-2 mb-4">
                        <h4 className="text-md font-semibold text-slate-300 mb-2">{state}</h4>

                        {Object.entries(cities).map(([city, lms]) => (
                          <div key={city} className="ml-3 mt-1 pl-3 border-l-2 border-slate-700 mb-3">
                            <h5 className="text-sm font-bold text-slate-500 mb-2 uppercase tracking-wider">{city}</h5>
                            <div className="space-y-2">
                              {lms.map(lm => (
                                <div key={lm.id} className="flex items-center gap-3 text-white bg-slate-900/80 p-3 rounded-xl border border-slate-700 shadow-sm">
                                  <div className={`p-2 rounded-lg ${lm.type === 'park/boundary' ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                                    {lm.type === 'park/boundary' ?
                                      <Trees size={16} className="text-green-400" /> :
                                      <Star size={16} className="text-yellow-400 fill-yellow-400" />
                                    }
                                  </div>
                                  <div className="w-full">
                                    <div className="font-semibold text-sm flex items-center gap-2">
                                      {lm.name}
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-widest ${lm.type === 'park/boundary' ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-300'}`}>
                                        {lm.specificType || lm.type}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono mt-0.5 mb-1">
                                      Found: {new Date(lm.date).toLocaleDateString()}
                                    </div>

                                    {(lm.description || lm.wikipedia) && (
                                      <div className="mt-2 text-xs text-slate-400 border-t border-slate-700/50 pt-2 space-y-1">
                                        {lm.description && <p className="italic text-slate-300">"{lm.description}"</p>}
                                        {lm.wikipedia && (
                                          <a href={lm.wikipedia} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors">
                                            <Globe size={10} /> Read on Wikipedia
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            
            {/* Developer Section */}
            <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-purple-400">
                <Bug size={20} /> Developer Tools
              </h3>
              
              <div className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl">
                <div>
                  <div className="font-semibold text-white">Debug Mode</div>
                  <div className="text-xs text-slate-400">Enables D-Pad manual movement and Teleporting.</div>
                </div>
                <button 
                  onClick={() => setDebugMode(!debugMode)} 
                  className={`relative w-12 h-6 rounded-full transition-colors ${debugMode ? 'bg-purple-500' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${debugMode ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>

            {/* Tags Section */}
            <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700">
              
              {/* NEW: Updated Header with Save/Reset Controls */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-blue-400">
                  <Tag size={20} /> OSM Tag Manager
                </h3>
                <div className="flex gap-2">
                  <button onClick={resetOsmTags} className="px-3 py-1.5 text-xs font-semibold bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors">
                    Reset
                  </button>
                  <button onClick={saveOsmTags} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-lg">
                    Save Changes
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-6">Select which OpenStreetMap tags trigger glowing stars on your map.</p>

              {/* Add New Tag Form */}
              <form onSubmit={handleAddNewTag} className="flex gap-2 mb-6 bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                <input 
                  type="text" 
                  placeholder="Key (e.g. shop)" 
                  value={newTagKey} 
                  onChange={e => setNewTagKey(e.target.value)}
                  className="w-1/3 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
                <input 
                  type="text" 
                  placeholder="Value (e.g. bakery)" 
                  value={newTagValue} 
                  onChange={e => setNewTagValue(e.target.value)}
                  className="w-1/2 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
                <button type="submit" className="w-1/6 bg-blue-600 hover:bg-blue-500 flex justify-center items-center rounded-lg text-white transition-colors">
                  <Plus size={18} />
                </button>
              </form>

              {/* Render Tag Categories (NEW: Mapping over draftOsmTags) */}
              <div className="space-y-4">
                {Object.entries(draftOsmTags).map(([category, valuesObj]) => (
                  <div key={category} className="border-l-2 border-slate-600 pl-3">
                    <h4 className="text-sm font-bold text-slate-300 mb-2 uppercase tracking-wider">{category}</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(valuesObj).map(([val, isActive]) => (
                        <button
                          key={val}
                          onClick={() => toggleOsmTag(category, val)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            isActive 
                            ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 hover:bg-blue-500/30' 
                            : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}