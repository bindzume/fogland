import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navigation, Sparkles, MapPin } from 'lucide-react';

import TopStatus from './components/TopStatus';
import BottomControls from './components/BottomControls';
import TeleportModal from './components/TeleportModal';
import ProfileOverlay from './components/ProfileOverlay';

const BASE_ZOOM = 16;
const STEP_SIZE = 0.00015; 
const ERASER_WIDTH_KM = 0.020;
const COLLECTION_RADIUS_KM = 0.015; 
const VIEW_HALF_SIZE = 0.01; 
const CELL_SIZE = 0.0005; 
const MIN_EXPLORE_PERCENT = 0.05

const FALLBACK_LAT = 37.7799;
const FALLBACK_LNG = -121.9780;

const DEFAULT_OSM_TAGS = {
  tourism: { museum: true, attraction: true, viewpoint: true, gallery: true, artwork: true, zoo: true, aquarium: true, yes: true },
  historic: { monument: true, memorial: true, ruins: true, castle: true, archaeological_site: true, ship: true },
  natural: { peak: true, waterfall: true, cave_entrance: true, spring: true },
  man_made: { lighthouse: true, windmill: true, obelisk: true, watermill: true, tower: true },
  amenity: { fountain: true, clock: true },
  leisure: { park: true, nature_reserve: true, water_park: true, garden: true, stadium: true, marina: true },
  boundary: { protected_area: true, national_park: true }
};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcBBoxAreaKm2(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return 0;
  const [latMin, latMax, lonMin, lonMax] = bbox.map(Number);
  const heightKm = getDistanceKm(latMin, lonMin, latMax, lonMin);
  const widthKm = getDistanceKm(latMin, lonMin, latMin, lonMax);
  return heightKm * widthKm * 0.7;
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const canvasRef = useRef(null);
  const watchIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastReportedPosRef = useRef(null);

  const pathRef = useRef([]);
  const visitedCellsRef = useRef(new Set());
  const lastFetchBoxRef = useRef(null);

  const nearbyLandmarksRef = useRef([]);
  const collectedLandmarksRef = useRef([]);

  const [currentPos, setCurrentPos] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [gpsActive, setGpsActive] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  // NEW: State for our splash screen
  const [appStarted, setAppStarted] = useState(false);
  const [permissionState, setPermissionState] = useState('checking'); // 'checking', 'prompt', 'granted', 'denied'

  // Core App States
  const [showTeleportModal, setShowTeleportModal] = useState(false);
  const [teleportQuery, setTeleportQuery] = useState('');
  const [isTeleporting, setIsTeleporting] = useState(false);
  const [showOnlyWiki, setShowOnlyWiki] = useState(false);
  const showOnlyWikiRef = useRef(false);

  // Profile States
  const [showProfile, setShowProfile] = useState(false);
  const [showConfirmWipe, setShowConfirmWipe] = useState(false);
  const [activeTab, setActiveTab] = useState('stats');
  const [geoData, setGeoData] = useState(null);
  const [stats, setStats] = useState({ distance: 0, areaKm: 0 });
  const [regionalAreas, setRegionalAreas] = useState({ country: null, state: null, local: null });

  const [nearbyLandmarks, setNearbyLandmarks] = useState([]);
  const [collectedLandmarks, setCollectedLandmarks] = useState([]);
  const [justCollected, setJustCollected] = useState(null);

  // Settings States
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('fogWorldDebug') === 'true');
  
  // Active tags (Trigger Overpass fetch)
  const [osmTags, setOsmTags] = useState(() => {
    const saved = localStorage.getItem('fogWorldTags');
    return saved ? JSON.parse(saved) : DEFAULT_OSM_TAGS;
  });

  // NEW: Draft tags (Only affect the UI until Saved)
  const [draftOsmTags, setDraftOsmTags] = useState(osmTags);

  useEffect(() => {
    localStorage.setItem('fogWorldDebug', debugMode);
  }, [debugMode]);

  // Persist active settings and force a refetch when they are SAVED
  useEffect(() => {
    localStorage.setItem('fogWorldTags', JSON.stringify(osmTags));
    lastFetchBoxRef.current = null; 
  }, [osmTags]);

  // Sync draft tags when profile is opened (discards unsaved changes if they closed the menu)
  useEffect(() => {
    if (showProfile) {
      setDraftOsmTags(osmTags);
    }
  }, [showProfile, osmTags]);


 // 1. Load Data & Check Permissions
  useEffect(() => {
    // ... (Keep your existing try/catch blocks for loading fogWorldLivePath and fogWorldCollected here) ...
    try {
      const savedPath = localStorage.getItem('fogWorldLivePath');
      if (savedPath) {
        const parsed = JSON.parse(savedPath);
        if (Array.isArray(parsed)) {
          pathRef.current = parsed.filter(p => p === null || (Array.isArray(p) && p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])));
          const cells = new Set();
          pathRef.current.forEach(p => {
            if (p && Array.isArray(p) && p.length === 2) {
              cells.add(`${Math.floor(p[0] / CELL_SIZE)}_${Math.floor(p[1] / CELL_SIZE)}`);
            }
          });
          visitedCellsRef.current = cells;
        }
      }
    } catch (e) {}

    try {
      const savedBag = localStorage.getItem('fogWorldCollected');
      if (savedBag) {
        const parsedBag = JSON.parse(savedBag);
        if (Array.isArray(parsedBag)) setCollectedLandmarks(parsedBag);
      }
    } catch (e) {}

    // NEW: Check Permissions instead of blindly requesting GPS
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setPermissionState(result.state);
        if (result.state === 'granted') {
          // If already granted in a previous session, we can safely auto-start
          startAppTracking();
        } else {
          setPermissionState('prompt');
        }
      });
    } else {
      // Fallback for Safari/Older browsers
      setPermissionState('prompt');
    }
  }, []);

  // NEW: The function that triggers the GPS request (Satisfies User Gesture)
  const startAppTracking = () => {
    setAppStarted(true);
    setIsLocating(true);
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          handleNewLocation([position.coords.latitude, position.coords.longitude]);
          setIsLocating(false);
          setPermissionState('granted');
        },
        (error) => {
          console.warn("Raw GPS Error:", error.code, error.message);
          
          // Translate the cryptic error codes if the message is blank
          let errorDesc = "Unknown Error";
          if (error.code === 1) errorDesc = "Permission Denied (Check browser or OS location settings)";
          if (error.code === 2) errorDesc = "Position Unavailable (No signal or disabled by OS)";
          if (error.code === 3) errorDesc = "Timeout (Took too long to find location)";

          const finalMessage = error.message || errorDesc;
          
          setLocationError(`GPS Error: ${finalMessage}. Using fallback.`);
          handleNewLocation([FALLBACK_LAT, FALLBACK_LNG]);
          setIsLocating(false);
          setGpsActive(false);
          setPermissionState('denied');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 } // Added a 10s timeout
      );
    } else {
      setLocationError("Geolocation not supported by this browser.");
      handleNewLocation([FALLBACK_LAT, FALLBACK_LNG]);
      setIsLocating(false);
      setGpsActive(false);
    }
  };

  // 2. Watch Real GPS (With Anti-Drift Threshold)
  useEffect(() => {
    if (!gpsActive || isLocating || !appStarted) {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      return;
    }
    
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;

        // Anti-Jitter: Calculate distance from the last time we updated the map
        if (lastReportedPosRef.current) {
          const distKm = getDistanceKm(
            lastReportedPosRef.current[0], lastReportedPosRef.current[1],
            newLat, newLng
          );
          
          // 0.005 km = 5 meters. If we moved less than 5m, ignore the micro-drift!
          if (distKm < 0.005) {
            return; 
          }
        }

        // If we made it here, it's a real movement. Save it and update the map!
        lastReportedPosRef.current = [newLat, newLng];
        handleNewLocation([newLat, newLng]);
      },
      (error) => console.warn("GPS Watch error:", error),
      // Tweaked settings to prevent hardware exhaustion
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 } 
    );
    
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [gpsActive, isLocating, appStarted]);


  // Drawing Fog
  const drawFog = useCallback(() => {
    try {
      const canvas = canvasRef.current;
      const map = mapInstanceRef.current;
      if (!canvas || !map || !pathRef.current || pathRef.current.length === 0) return;

      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const scale = Math.pow(2, map.getZoom() - BASE_ZOOM);
      ctx.lineWidth = 50 * scale;
      ctx.beginPath();
      
      let isFirst = true;
      for (let i = 0; i < pathRef.current.length; i++) {
        const p = pathRef.current[i];
        if (!p || !Array.isArray(p) || p.length !== 2) {
          isFirst = true; continue;
        }
        const point = map.latLngToContainerPoint(p);
        if (isFirst) { ctx.moveTo(point.x, point.y); isFirst = false; } 
        else { ctx.lineTo(point.x, point.y); }
      }
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '28px Arial';

      const uncollected = nearbyLandmarksRef.current.filter(lm =>
        !collectedLandmarksRef.current.some(c => c.id === lm.id) &&
        (!showOnlyWikiRef.current || lm.wikipedia)
      );

      uncollected.forEach(lm => {
        const pt = map.latLngToContainerPoint([lm.lat, lm.lon]);
        if (pt.x > -50 && pt.x < canvas.width + 50 && pt.y > -50 && pt.y < canvas.height + 50) {
          if (lm.isBoundary) {
            const pct = Math.min(99, Math.floor(((lm.progressCount || 0) / lm.requiredCells) * 100));
            ctx.shadowColor = 'rgba(74, 222, 128, 1)'; ctx.shadowBlur = 20;
            ctx.fillText('⭐', pt.x, pt.y); ctx.shadowBlur = 0;
            ctx.fillStyle = '#4ade80'; ctx.font = 'bold 14px Arial'; ctx.fillText(`${pct}% 🌲`, pt.x, pt.y - 20);
          } else {
            ctx.shadowColor = 'rgba(250, 204, 21, 1)'; ctx.shadowBlur = 20;
            ctx.fillText('⭐', pt.x, pt.y); ctx.shadowBlur = 0;
          }
        }
      });
    } catch (err) {}
  }, []);

  useEffect(() => {
    showOnlyWikiRef.current = showOnlyWiki;
    drawFog();
  }, [showOnlyWiki, drawFog]);
  useEffect(() => { nearbyLandmarksRef.current = nearbyLandmarks; drawFog(); }, [nearbyLandmarks, drawFog]);
  useEffect(() => { collectedLandmarksRef.current = collectedLandmarks; drawFog(); }, [collectedLandmarks, drawFog]);

  // Handle Location Updates
 const handleNewLocation = useCallback((newPos) => {
    try {
      if (!Array.isArray(newPos) || newPos.length !== 2) return;
      
      // 1. Update React State & Local Storage
      setCurrentPos(newPos);
      const updatedPath = [...pathRef.current, newPos];
      pathRef.current = updatedPath;
      try { localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath)); } catch (e) { }

      // 2. Grid Exploration Logic (Keep this exactly as is)
      const cellId = `${Math.floor(newPos[0] / CELL_SIZE)}_${Math.floor(newPos[1] / CELL_SIZE)}`;
      let newlyExploredCell = false;

      if (!visitedCellsRef.current.has(cellId)) {
        visitedCellsRef.current.add(cellId);
        newlyExploredCell = true;
      }

      if (newlyExploredCell) {
        setNearbyLandmarks(prev => {
          let updated = false;
          const next = prev.map(lm => {
            if (lm.isBoundary && !collectedLandmarksRef.current.some(c => c.id === lm.id)) {
              if (newPos[0] >= lm.bounds.minlat && newPos[0] <= lm.bounds.maxlat &&
                newPos[1] >= lm.bounds.minlon && newPos[1] <= lm.bounds.maxlon) {
                updated = true;
                return { ...lm, progressCount: (lm.progressCount || 0) + 1 };
              }
            }
            return lm;
          });
          return updated ? next : prev;
        });
      }

      // 3. THE FIX: Smooth Map Updating
      if (markerRef.current) {
        markerRef.current.setLatLng(newPos); // Always move the blue dot
      }

      if (mapInstanceRef.current) {
        // Check if the new coordinate is currently visible on the screen
        const bounds = mapInstanceRef.current.getBounds();
        const isVisible = bounds.contains(window.L.latLng(newPos[0], newPos[1]));
        
        // ONLY move the background map if the user walks off the screen
        if (!isVisible) {
          mapInstanceRef.current.panTo(newPos, { animate: true, duration: 1 });
        }
      }
      
      drawFog();
    } catch (err) {}
  }, [drawFog]);

  // 3. Fetch Nearby Landmarks
  useEffect(() => {
    if (!currentPos || !Array.isArray(currentPos)) return;

    const needsFetch = !lastFetchBoxRef.current ||
      currentPos[0] < lastFetchBoxRef.current.minLat ||
      currentPos[0] > lastFetchBoxRef.current.maxLat ||
      currentPos[1] < lastFetchBoxRef.current.minLon ||
      currentPos[1] > lastFetchBoxRef.current.maxLon;

    if (needsFetch) {
      const [lat, lon] = currentPos;
      lastFetchBoxRef.current = {
        minLat: lat - VIEW_HALF_SIZE, maxLat: lat + VIEW_HALF_SIZE,
        minLon: lon - VIEW_HALF_SIZE, maxLon: lon + VIEW_HALF_SIZE
      };

      const fetchMinLat = (lat - VIEW_HALF_SIZE * 2).toFixed(5);
      const fetchMaxLat = (lat + VIEW_HALF_SIZE * 2).toFixed(5);
      const fetchMinLon = (lon - VIEW_HALF_SIZE * 2).toFixed(5);
      const fetchMaxLon = (lon + VIEW_HALF_SIZE * 2).toFixed(5);

      let dynamicNodes = '';
      Object.entries(osmTags).forEach(([key, valuesObj]) => {
        const activeValues = Object.entries(valuesObj).filter(([_, isActive]) => isActive).map(([v]) => v);
        if (activeValues.length > 0) {
          dynamicNodes += `  nwr["${key}"~"${activeValues.join('|')}"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});\n`;
        }
      });

      if (!dynamicNodes) {
        setNearbyLandmarks([]);
        return;
      }

      const query = `[out:json][timeout:25];\n(\n${dynamicNodes});\nout center bb;`;

      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.elements) {
            const items = data.elements
              .filter(e => e.tags && e.tags.name)
              .map(e => {
                const isBoundaryType = e.tags.leisure || e.tags.boundary || (e.tags.historic && e.bounds);
                const isBoundary = isBoundaryType && !!e.bounds;

                let progressCount = 0;
                let requiredCells = 0;

                if (isBoundary) {
                  const widthCells = Math.abs(e.bounds.maxlon - e.bounds.minlon) / CELL_SIZE;
                  const heightCells = Math.abs(e.bounds.maxlat - e.bounds.minlat) / CELL_SIZE;
                  requiredCells = Math.max(1, Math.min(100, Math.floor((widthCells * heightCells) * MIN_EXPLORE_PERCENT)));

                  for (let c of visitedCellsRef.current) {
                    const [cLatStr, cLonStr] = c.split('_');
                    const centerLat = (parseInt(cLatStr) + 0.5) * CELL_SIZE;
                    const centerLon = (parseInt(cLonStr) + 0.5) * CELL_SIZE;
                    if (centerLat >= e.bounds.minlat && centerLat <= e.bounds.maxlat && centerLon >= e.bounds.minlon && centerLon <= e.bounds.maxlon) {
                      progressCount++;
                    }
                  }
                }

                let computedLat = e.lat || (e.center && e.center.lat) || (e.bounds && (e.bounds.minlat + e.bounds.maxlat) / 2);
                let computedLon = e.lon || (e.center && e.center.lon) || (e.bounds && (e.bounds.minlon + e.bounds.maxlon) / 2);

                let rawType = 'Landmark';
                const keyPriorities = ['natural', 'historic', 'man_made', 'tourism', 'amenity', 'leisure', 'boundary'];
                for (let k of keyPriorities) {
                  if (e.tags[k]) { rawType = e.tags[k]; break; }
                }

                const specificType = rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                let wikiLink = null;
                if (e.tags.wikipedia) {
                  const parts = e.tags.wikipedia.split(':');
                  if (parts.length === 2) wikiLink = `https://${parts[0]}.wikipedia.org/wiki/${encodeURIComponent(parts[1])}`;
                }

                return {
                  id: e.id, name: e.tags.name, lat: computedLat, lon: computedLon,
                  type: isBoundaryType ? 'park/boundary' : 'point', specificType, 
                  description: e.tags.description || null, wikipedia: wikiLink, 
                  isBoundary, bounds: e.bounds, progressCount, requiredCells,
                };
              })
              .filter(e => e.lat != null && e.lon != null);

            setNearbyLandmarks(prev => {
              const map = new Map();
              prev.forEach(lm => { if (getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < 10) map.set(lm.id, lm); });
              items.forEach(lm => map.set(lm.id, lm));
              return Array.from(map.values());
            });
          }
        })
        .catch(err => console.error("Overpass Fetch Failed:", err));
    }
  }, [currentPos, osmTags]);

// 4. Collect Nearby Landmarks
  useEffect(() => {
    if (!currentPos || !Array.isArray(currentPos)) return;
    
    nearbyLandmarks.forEach(async (lm) => {
      if (collectedLandmarks.some(c => c.id === lm.id)) return;
      let shouldCollect = false;

      if (lm.isBoundary) {
        // Condition 1: Standard Area Exploration (For large parks)
        if (lm.progressCount >= lm.requiredCells) {
          shouldCollect = true;
        }
        // Condition 2: Small Area Bypass (The Fix for tiny plazas)
        // If the area is very small, and you are standing physically inside its bounding box, collect it!
        else if (lm.requiredCells <= 3 && 
                 currentPos[0] >= lm.bounds.minlat && currentPos[0] <= lm.bounds.maxlat &&
                 currentPos[1] >= lm.bounds.minlon && currentPos[1] <= lm.bounds.maxlon) {
          console.log(`[Fog World] Bypassed grid for small area: ${lm.name}`);
          shouldCollect = true;
        }
        // Condition 3: Dead-Center Failsafe
        // If the user physically touches the exact mathematical center coordinate of any boundary, grant it.
        else if (getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < COLLECTION_RADIUS_KM) {
          shouldCollect = true;
        }
      } 
      // Standard Point Landmark Collection
      else if (!lm.isBoundary && getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < COLLECTION_RADIUS_KM) {
        shouldCollect = true;
      }

      if (shouldCollect) {
        const partial = { ...lm, country: 'Discovering...', state: '...', city: '...', date: Date.now() };
        setCollectedLandmarks(prev => {
          const newBag = [...prev, partial];
          try { localStorage.setItem('fogWorldCollected', JSON.stringify(newBag)); } catch (e) { }
          return newBag;
        });
        
        setJustCollected(lm.name); 
        setTimeout(() => setJustCollected(null), 4000);

        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lm.lat}&lon=${lm.lon}&format=json`);
          const data = await res.json();
          if (data && data.address) {
            setCollectedLandmarks(prev => {
              const updated = prev.map(p => p.id === lm.id ? {
                ...p, 
                country: data.address.country || 'Unknown', 
                state: data.address.state || 'Unknown',
                city: data.address.city || data.address.town || data.address.village || data.address.county || 'Unknown'
              } : p);
              try { localStorage.setItem('fogWorldCollected', JSON.stringify(updated)); } catch (e) { }
              return updated;
            });
          }
        } catch (e) {}
      }
    });
  }, [currentPos, nearbyLandmarks, collectedLandmarks]);

  // Initialize Map
  useEffect(() => {
    if (isLocating || mapInstanceRef.current || !currentPos) return;
    let isMounted = true;
    const initMap = async () => {
      try {
        if (!window.L) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
          await new Promise((resolve) => {
            const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.crossOrigin = 'anonymous'; script.onload = resolve; script.onerror = resolve; document.head.appendChild(script);
          });
        }
        if (!isMounted || mapInstanceRef.current || !window.L) return;

        const map = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView(currentPos, BASE_ZOOM);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

        const userIcon = window.L.divIcon({ className: 'custom-div-icon', html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
        markerRef.current = window.L.marker(currentPos, { icon: userIcon }).addTo(map);
        mapInstanceRef.current = map; setMapReady(true);
        map.on('move', drawFog); map.on('zoom', drawFog); window.addEventListener('resize', drawFog);

        map.on('dblclick', (e) => {
          if (localStorage.getItem('fogWorldDebug') !== 'true') return;
          setGpsActive(false);
          const newPos = [e.latlng.lat, e.latlng.lng];
          const updatedPath = [...pathRef.current, null, newPos];
          pathRef.current = updatedPath;
          try { localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath)); } catch (err) { }
          handleNewLocation(newPos);
        });
        setTimeout(drawFog, 100);
      } catch (err) {}
    };
    initMap();
    return () => { isMounted = false; window.removeEventListener('resize', drawFog); if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; setMapReady(false); } };
  }, [isLocating, currentPos, drawFog, handleNewLocation]);

  const manualMove = (latOffset, lngOffset) => {
    if (!currentPos || !Array.isArray(currentPos) || !debugMode) return;
    setGpsActive(false); handleNewLocation([currentPos[0] + latOffset, currentPos[1] + lngOffset]);
  };

  const executeClearData = () => {
    pathRef.current = currentPos && Array.isArray(currentPos) ? [currentPos] : [];
    visitedCellsRef.current = new Set();
    localStorage.removeItem('fogWorldLivePath'); localStorage.removeItem('fogWorldCollected');
    setCollectedLandmarks([]); collectedLandmarksRef.current = [];
    drawFog(); setShowConfirmWipe(false); setShowProfile(false);
  };

  const handleExport = () => {
    const data = { path: pathRef.current, collected: collectedLandmarks };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fog-world-${new Date().toISOString().split('T')[0]}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.path && Array.isArray(data.path)) {
          pathRef.current = data.path; localStorage.setItem('fogWorldLivePath', JSON.stringify(data.path));
          const cells = new Set();
          data.path.forEach(p => { if (p && Array.isArray(p) && p.length === 2) cells.add(`${Math.floor(p[0] / CELL_SIZE)}_${Math.floor(p[1] / CELL_SIZE)}`); });
          visitedCellsRef.current = cells;
        }
        if (data.collected && Array.isArray(data.collected)) {
          setCollectedLandmarks(data.collected); collectedLandmarksRef.current = data.collected;
          localStorage.setItem('fogWorldCollected', JSON.stringify(data.collected));
        }
        drawFog(); alert("Save imported!");
      } catch (err) { alert("Invalid save file."); }
    };
    reader.readAsText(file); e.target.value = null;
  };

  const executeTeleport = async () => {
    if (!teleportQuery.trim() || !debugMode) return;
    setIsTeleporting(true);
    try {
      let lat, lon; const coords = teleportQuery.trim().split(',').map(s => s.trim());
      if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) { lat = parseFloat(coords[0]); lon = parseFloat(coords[1]); } 
      else {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(teleportQuery)}&format=json&limit=1`);
        const data = await res.json();
        if (data && data.length > 0) { lat = parseFloat(data[0].lat); lon = parseFloat(data[0].lon); } 
        else { alert("Location not found!"); setIsTeleporting(false); return; }
      }
      setGpsActive(false); const newPos = [lat, lon];
      const updatedPath = [...pathRef.current, null, newPos]; pathRef.current = updatedPath;
      try { localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath)); } catch (e) { }
      handleNewLocation(newPos); if (mapInstanceRef.current) mapInstanceRef.current.setView(newPos, mapInstanceRef.current.getZoom(), { animate: false });
      setShowTeleportModal(false); setTeleportQuery('');
    } catch (e) { alert("Teleport failed."); }
    setIsTeleporting(false);
  };

  const fetchBBoxArea = async (query) => {
    try { const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`); const data = await res.json(); if (data && data[0] && data[0].boundingbox) return calcBBoxAreaKm2(data[0].boundingbox); } catch (e) { } return null;
  };

  const openProfile = async () => {
    setShowProfile(true); setRegionalAreas({ country: null, state: null, local: null });
    let totalDistKm = 0; const path = pathRef.current || [];
    for (let i = 1; i < path.length; i++) { if (path[i - 1] && path[i] && Array.isArray(path[i - 1]) && Array.isArray(path[i])) totalDistKm += getDistanceKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]); }
    setStats({ distance: totalDistKm, areaKm: totalDistKm * ERASER_WIDTH_KM });
    if (!currentPos || !Array.isArray(currentPos)) return;
    let country, state, local;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${currentPos[0]}&lon=${currentPos[1]}&format=json`);
      const data = await res.json();
      if (data && data.address) {
        country = data.address.country; state = data.address.state; local = data.address.city || data.address.town || data.address.county;
        setGeoData({ country: country || 'Unknown', state: state || 'Unknown', city: local || 'Unknown' });
      }
    } catch (e) { return; }
    if (country) { try { const cRes = await fetch(`https://restcountries.com/v3.1/name/${country}?fullText=true`); const cData = await cRes.json(); if (cData && cData[0] && cData[0].area) setRegionalAreas(prev => ({ ...prev, country: cData[0].area })); } catch (e) { } }
    if (state) { const sArea = await fetchBBoxArea(`${state}, ${country}`); if (sArea) setRegionalAreas(prev => ({ ...prev, state: sArea })); }
    if (local) { setTimeout(async () => { const lArea = await fetchBBoxArea(`${local}, ${state}, ${country}`); if (lArea) setRegionalAreas(prev => ({ ...prev, local: lArea })); }, 1200); }
  };

  // NEW: Update draft tags instead of triggering a live save
  const toggleOsmTag = (category, value) => {
    setDraftOsmTags(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [value]: !prev[category][value]
      }
    }));
  };

  // NEW: Update draft tags instead of triggering a live save
  const addOsmTag = (key, value) => {
    const k = key.trim().toLowerCase();
    const v = value.trim().toLowerCase();
    if (!/^[a-z0-9_:]+$/.test(k) || !/^[a-z0-9_:]+$/.test(v)) {
      alert("Invalid tag format. Use only lowercase letters, numbers, or underscores.");
      return false;
    }
    setDraftOsmTags(prev => ({
      ...prev,
      [k]: {
        ...(prev[k] || {}),
        [v]: true
      }
    }));
    return true;
  };

  // NEW: Master push to live state
  const saveOsmTags = () => {
    setOsmTags(draftOsmTags);
    alert("Map tags saved and updated!");
  };

  // NEW: Master reset back to defaults
  const resetOsmTags = () => {
    setDraftOsmTags(DEFAULT_OSM_TAGS);
  };

  const visibleCollected = showOnlyWiki ? (collectedLandmarks || []).filter(lm => lm.wikipedia) : (collectedLandmarks || []);
  const groupedBag = Array.isArray(visibleCollected) ? visibleCollected.reduce((acc, lm) => {
    const c = lm.country || 'Unknown', s = lm.state || 'Unknown', city = lm.city || 'Unknown';
    if (!acc[c]) acc[c] = {}; if (!acc[c][s]) acc[c][s] = {}; if (!acc[c][s][city]) acc[c][s][city] = [];
    acc[c][s][city].push(lm); return acc;
  }, {}) : {};

  if (!appStarted && permissionState === 'prompt') {
    return (
      <div className="flex flex-col items-center justify-center w-full h-screen bg-slate-900 text-white p-6 text-center">
        <MapPin className="text-blue-500 mb-6" size={64} />
        <h1 className="text-4xl font-bold mb-4">Fog World</h1>
        <p className="text-slate-400 mb-8 max-w-sm">
          Explore the real world to clear the fog and discover hidden landmarks, parks, and historical sites.
        </p>
        <button 
          onClick={startAppTracking} 
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-2xl shadow-[0_0_30px_rgba(37,99,235,0.4)] transition-all active:scale-95 text-lg"
        >
          Start Exploring
        </button>
      </div>
    );
  }

  if (isLocating) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-screen bg-slate-900 text-white">
        <Navigation className="animate-bounce mb-4 text-blue-500" size={40} />
        <h2 className="text-xl font-bold">Acquiring GPS Signal...</h2>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 font-sans">
      {justCollected && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-bounce pointer-events-none">
          <div className="bg-yellow-400 text-slate-900 font-bold px-6 py-3 rounded-full shadow-[0_0_30px_rgba(250,204,21,0.5)] flex items-center gap-2 border-2 border-yellow-200">
            <Sparkles size={20} className="text-white fill-white" /> Found: {justCollected}!
          </div>
        </div>
      )}

      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />
      <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full pointer-events-none" />

      <TopStatus locationError={locationError} openProfile={openProfile} />
      <BottomControls 
        gpsActive={gpsActive} setGpsActive={setGpsActive} setShowTeleportModal={setShowTeleportModal} 
        showOnlyWiki={showOnlyWiki} setShowOnlyWiki={setShowOnlyWiki} manualMove={manualMove} STEP_SIZE={STEP_SIZE} 
        debugMode={debugMode} 
      />
      <TeleportModal 
        showTeleportModal={showTeleportModal} setShowTeleportModal={setShowTeleportModal} teleportQuery={teleportQuery} 
        setTeleportQuery={setTeleportQuery} executeTeleport={executeTeleport} isTeleporting={isTeleporting} 
      />
      
      {/* Updated Props */}
      <ProfileOverlay 
        showProfile={showProfile} setShowProfile={setShowProfile} handleImport={handleImport} handleExport={handleExport} 
        fileInputRef={fileInputRef} showConfirmWipe={showConfirmWipe} setShowConfirmWipe={setShowConfirmWipe} executeClearData={executeClearData} 
        activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} geoData={geoData} regionalAreas={regionalAreas} groupedBag={groupedBag} 
        visibleCollectedCount={Array.isArray(visibleCollected) ? visibleCollected.length : 0} showOnlyWiki={showOnlyWiki}
        debugMode={debugMode} setDebugMode={setDebugMode} 
        draftOsmTags={draftOsmTags} toggleOsmTag={toggleOsmTag} addOsmTag={addOsmTag} 
        saveOsmTags={saveOsmTags} resetOsmTags={resetOsmTags}
      />
    </div>
  );
}