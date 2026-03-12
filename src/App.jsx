import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navigation, Sparkles, MapPin } from 'lucide-react';
import { KeepAwake } from '@capacitor-community/keep-awake';

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

const DEFAULT_SEARCH_RADIUS = 0.05; // ~5.5km default
const MIN_SEARCH_RADIUS = 0.01;     // ~1.1km minimum
const MAX_SEARCH_RADIUS = 0.10;     // ~11km hard max to avoid rate limiting

// Rate limiter for Overpass API — queues requests so they're spaced at least 1.5s apart
const overpassRateLimiter = (() => {
  let lastRequestTime = 0;
  let requestCount = 0;
  const MIN_INTERVAL_MS = 1500;
  let queue = Promise.resolve();

  return () => {
    requestCount++;
    const thisRequest = requestCount;
    queue = queue.then(() => {
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < MIN_INTERVAL_MS) {
        const delayMs = MIN_INTERVAL_MS - elapsed;
        console.log(`[Overpass RL] Request #${thisRequest} throttled — waiting ${delayMs}ms (last request ${elapsed}ms ago)`);
        return new Promise(resolve => {
          setTimeout(() => {
            lastRequestTime = Date.now();
            resolve();
          }, delayMs);
        });
      }
      console.log(`[Overpass RL] Request #${thisRequest} cleared — ${elapsed}ms since last request`);
      lastRequestTime = Date.now();
    });
    return queue;
  };
})();

// Custom fetcher that handles 429/503/504 with exponential backoff + rate limiting
const fetchWithRetry = async (url, body, retries = 4, initialBackoff = 2000) => {
  const requestId = `req_${Date.now().toString(36)}`;
  const queryPreview = body.length > 120 ? body.slice(0, 120) + '…' : body;
  console.group(`[Overpass] ${requestId} — Starting request`);
  console.log(`[Overpass] URL: ${url}`);
  console.log(`[Overpass] Query: ${queryPreview}`);
  console.log(`[Overpass] Config: retries=${retries}, initialBackoff=${initialBackoff}ms`);
  console.groupEnd();

  let backoff = initialBackoff;
  for (let i = 0; i < retries; i++) {
    console.log(`[Overpass] ${requestId} — Attempt ${i + 1}/${retries}, awaiting rate limiter...`);
    const rlStart = Date.now();
    await overpassRateLimiter();
    const rlWait = Date.now() - rlStart;
    if (rlWait > 50) {
      console.log(`[Overpass] ${requestId} — Rate limiter held for ${rlWait}ms`);
    }

    try {
      const fetchStart = Date.now();
      console.log(`[Overpass] ${requestId} — Sending POST...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(body)}`
      });
      const fetchDuration = Date.now() - fetchStart;

      console.log(`[Overpass] ${requestId} — Response: ${response.status} ${response.statusText} (${fetchDuration}ms)`);

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, backoff) : backoff;
        console.warn(`[Overpass] ${requestId} — 429 Rate Limited! Retry-After header: ${retryAfter || 'none'}. Waiting ${waitMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        backoff *= 2;
        continue;
      }

      if (response.status === 503 || response.status === 504) {
        console.warn(`[Overpass] ${requestId} — ${response.status} Server Error. Waiting ${backoff}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }

      if (!response.ok) {
        console.error(`[Overpass] ${requestId} — Unexpected HTTP ${response.status}. Not retrying.`);
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      const elementCount = data?.elements?.length ?? 0;
      console.log(`[Overpass] ${requestId} — Success! Received ${elementCount} elements (total time: ${Date.now() - fetchStart}ms)`);
      return data;
    } catch (err) {
      if (i === retries - 1) {
        console.error(`[Overpass] ${requestId} — All ${retries} attempts exhausted. Final error:`, err.message);
        throw err;
      }
      console.warn(`[Overpass] ${requestId} — Network error: ${err.message}. Waiting ${backoff}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
    }
  }
};

export default function App() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const canvasRef = useRef(null);
  const watchIdRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastReportedPosRef = useRef(null);
  const loadedChunksRef = useRef(new Set());

  const pathRef = useRef([]);
  const visitedCellsRef = useRef(new Set());
  const lastFetchBoxRef = useRef(null);

  const nearbyLandmarksRef = useRef([]);
  const collectedLandmarksRef = useRef([]);

  const [currentPos, setCurrentPos] = useState([FALLBACK_LAT, FALLBACK_LNG]);
  const [gpsFailed, setGpsFailed] = useState(false);
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
  const [landmarkSearchTrigger, setLandmarkSearchTrigger] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

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

  const [isTracking, setIsTracking] = useState(true);
  // NEW: Add a ref to safely read this inside our map functions
  const isTrackingRef = useRef(isTracking);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);

  // Settings States
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('fogWorldDebug') === 'true');
  const [searchRadius, setSearchRadius] = useState(() => {
    const saved = parseFloat(localStorage.getItem('fogWorldSearchRadius'));
    return (saved >= MIN_SEARCH_RADIUS && saved <= MAX_SEARCH_RADIUS) ? saved : DEFAULT_SEARCH_RADIUS;
  });
  const searchRadiusRef = useRef(searchRadius);
  useEffect(() => {
    searchRadiusRef.current = searchRadius;
    localStorage.setItem('fogWorldSearchRadius', searchRadius.toString());
  }, [searchRadius]);
  
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

    startAppTracking();
  }, []);

  // NEW: The function that triggers the GPS request (Satisfies User Gesture)
const startAppTracking = async () => {
    setAppStarted(true);
    setIsLocating(true);
    setGpsFailed(false); // Clear previous errors on retry
    setLocationError('');
    
    try { await KeepAwake.keepAwake(); } catch (e) {}
    
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsActive(true); // Turn tracking back on if it was previously off
          handleNewLocation([position.coords.latitude, position.coords.longitude]);
          setIsLocating(false);
          setPermissionState('granted');
        },
        (error) => {
          console.warn("Raw GPS Error:", error.code, error.message);
          let errorDesc = "Unknown Error";
          if (error.code === 1) errorDesc = "Permission Denied";
          if (error.code === 2) errorDesc = "Position Unavailable";
          if (error.code === 3) errorDesc = "Timeout";

          setLocationError(`GPS Error: ${errorDesc}`);
          setIsLocating(false);
          setGpsActive(false);
          setGpsFailed(true); // Trigger the Retry Button!
          setPermissionState('denied');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
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
      
      
      //const updatedPath = [...pathRef.current, newPos];
      //pathRef.current = updatedPath;
      
      // === THE FIX: Prevent long lines on big jumps ===
      let updatedPath;
      const currentPath = pathRef.current;
      let lastValidPos = null;

      // Search backwards to find the most recent actual coordinate (ignoring previous nulls)
      for (let i = currentPath.length - 1; i >= 0; i--) {
        if (currentPath[i] && Array.isArray(currentPath[i]) && currentPath[i].length === 2) {
          lastValidPos = currentPath[i];
          break;
        }
      }

      if (lastValidPos) {
        // Calculate distance between the last recorded point and the new point
        const distKm = getDistanceKm(lastValidPos[0], lastValidPos[1], newPos[0], newPos[1]);

        // 0.1 km = 100 meters. If a single GPS update jumps further than this, break the line!
        if (distKm > 0.2) {
          updatedPath = [...currentPath, null, newPos];
          console.log("Large jump detected! Breaking the path line.");
        } else {
          updatedPath = [...currentPath, newPos];
        }
      } else {
        // First point ever
        updatedPath = [...currentPath, newPos];
      }

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

// 3. THE FIX: Smooth Map Updating (Now with Follow Mode!)
      if (markerRef.current) {
        markerRef.current.setLatLng(newPos); // Always move the blue dot
      }

// CHANGE THIS LINE: Use isTrackingRef.current instead of isTracking
      if (mapInstanceRef.current && isTrackingRef.current) {
        const bounds = mapInstanceRef.current.getBounds();
      }
      mapInstanceRef.current.panTo(newPos, { animate: true, duration: 1 });
      
      drawFog();
    } catch (err) {}
  }, [drawFog]);

  

  // Search for landmarks — clears caches for current chunk and re-fetches from Overpass
  const searchLandmarks = useCallback(() => {
    if (!currentPos || !Array.isArray(currentPos)) return;
    const [lat, lon] = currentPos;
    const chunkLat = Math.floor(lat / searchRadiusRef.current) * searchRadiusRef.current;
    const chunkLon = Math.floor(lon / searchRadiusRef.current) * searchRadiusRef.current;
    const chunkId = `osm_chunk_${chunkLat.toFixed(3)}_${chunkLon.toFixed(3)}`;

    console.log(`[Landmarks] Manual search triggered — clearing cache for ${chunkId}`);
    loadedChunksRef.current.delete(chunkId);
    try { localStorage.removeItem(chunkId); } catch (e) {}

    setIsSearching(true);
    setLandmarkSearchTrigger(prev => prev + 1);
  }, [currentPos]);

  // 3. Fetch Nearby Landmarks (Chunk Cached + Retry Enabled)
  useEffect(() => {
    if (!currentPos || !Array.isArray(currentPos)) return;

    const loadLandmarks = async () => {
      const [lat, lon] = currentPos;

      // Calculate strict chunk grid boundaries
      const chunkLat = Math.floor(lat / searchRadiusRef.current) * searchRadiusRef.current;
      const chunkLon = Math.floor(lon / searchRadiusRef.current) * searchRadiusRef.current;
      const chunkId = `osm_chunk_${chunkLat.toFixed(3)}_${chunkLon.toFixed(3)}`;

      console.log(`[Landmarks] Position: [${lat.toFixed(5)}, ${lon.toFixed(5)}] → Chunk: ${chunkId}`);

      // If we already processed this chunk during this app session, skip!
      if (loadedChunksRef.current.has(chunkId)) {
        console.log(`[Landmarks] Chunk ${chunkId} already loaded this session — skipping`);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      let rawElements = [];

      // --- 1. TRY CACHE FIRST ---
      try {
        const cached = localStorage.getItem(chunkId);
        if (cached) {
          rawElements = JSON.parse(cached);
          console.log(`[Landmarks] Cache HIT for ${chunkId} — ${rawElements.length} elements (${(cached.length / 1024).toFixed(1)}KB)`);
        } else {
          console.log(`[Landmarks] Cache MISS for ${chunkId}`);
        }
      } catch (e) { console.warn(`[Landmarks] Cache read error for ${chunkId}:`, e.message); }

      // --- 2. FETCH IF NOT CACHED ---
      if (rawElements.length === 0) {
        const minLat = chunkLat.toFixed(5);
        const maxLat = (chunkLat + searchRadiusRef.current).toFixed(5);
        const minLon = chunkLon.toFixed(5);
        const maxLon = (chunkLon + searchRadiusRef.current).toFixed(5);

        console.log(`[Landmarks] Fetching chunk from Overpass — bbox: [${minLat},${minLon},${maxLat},${maxLon}]`);

        let dynamicNodes = '';
        const activeTagSummary = [];
        Object.entries(osmTags).forEach(([key, valuesObj]) => {
          const activeValues = Object.entries(valuesObj).filter(([_, isActive]) => isActive).map(([v]) => v);
          if (activeValues.length > 0) {
            dynamicNodes += `  nwr["${key}"~"${activeValues.join('|')}"](${minLat},${minLon},${maxLat},${maxLon});\n`;
            activeTagSummary.push(`${key}:[${activeValues.join(',')}]`);
          }
        });

        console.log(`[Landmarks] Active tags: ${activeTagSummary.join(', ')}`);

        if (!dynamicNodes) {
          console.warn('[Landmarks] No active OSM tags configured — skipping fetch');
          setNearbyLandmarks([]);
          setIsSearching(false);
          return;
        }

        const query = `[out:json][timeout:25];\n(\n${dynamicNodes});\nout center bb;`;

        try {
          const fetchStart = Date.now();
          const data = await fetchWithRetry('https://overpass-api.de/api/interpreter', query);
          const fetchDuration = Date.now() - fetchStart;

          if (data && data.elements) {
            rawElements = data.elements;
            console.log(`[Landmarks] Fetch complete — ${rawElements.length} elements in ${fetchDuration}ms`);

            // Save to LocalStorage to prevent ever querying this 5km area again
            try {
              const dataString = JSON.stringify(rawElements);
              if (dataString.length < 2000000) {
                localStorage.setItem(chunkId, dataString);
                console.log(`[Landmarks] Cached ${chunkId} — ${(dataString.length / 1024).toFixed(1)}KB`);
              } else {
                console.warn(`[Landmarks] Chunk too large to cache: ${(dataString.length / 1024).toFixed(1)}KB (limit 2MB)`);
              }
            } catch (e) { console.warn(`[Landmarks] Cache write failed: ${e.message}`); }
          } else {
            console.warn(`[Landmarks] Fetch returned no elements (${fetchDuration}ms)`);
          }
        } catch (err) {
          console.error(`[Landmarks] Overpass fetch failed after all retries:`, err.message);
          setIsSearching(false);
          return; // Abort processing if fetch failed entirely
        }
      }

      // --- 3. PROCESS DATA ---
      if (rawElements.length > 0) {
        const withNames = rawElements.filter(e => e.tags && e.tags.name);
        console.log(`[Landmarks] Processing: ${rawElements.length} raw → ${withNames.length} with names`);

        const items = withNames
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

        const boundaryCount = items.filter(i => i.isBoundary).length;
        const pointCount = items.length - boundaryCount;
        const wikiCount = items.filter(i => i.wikipedia).length;
        console.log(`[Landmarks] Processed: ${items.length} landmarks (${pointCount} points, ${boundaryCount} boundaries, ${wikiCount} with Wikipedia)`);

        // --- 4. UPDATE STATE ---
        setNearbyLandmarks(prev => {
          const map = new Map();
          // Keep old landmarks up to 15km away so they don't pop-out when crossing chunk lines
          const keptCount = prev.filter(lm => getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < 15).length;
          const prunedCount = prev.length - keptCount;
          prev.forEach(lm => { if (getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < 15) map.set(lm.id, lm); });
          items.forEach(lm => map.set(lm.id, lm));
          const result = Array.from(map.values());
          console.log(`[Landmarks] State update: ${prev.length} existing (${prunedCount} pruned >15km) + ${items.length} new → ${result.length} total`);
          return result;
        });

        // Mark chunk as successfully processed for this session
        loadedChunksRef.current.add(chunkId);
      }

      setIsSearching(false);
    };

    loadLandmarks();
  }, [currentPos, osmTags, landmarkSearchTrigger]);

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

        map.on('dragstart', () => {
          setIsTracking(false);
        });

        // NEW: Disable tracking if the user manually zooms in/out
        map.on('zoomstart', () => {
          setIsTracking(false);
        });

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
  }, [isLocating]);

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
      {/* Subtle Loading Indicator (Shows while hunting for GPS) */}
{/* Subtle Loading Indicator (Shows while hunting for GPS) */}
      {isLocating && (
        <div className="absolute top-[calc(max(1rem,env(safe-area-inset-top))+4.5rem)] left-4 z-20 bg-slate-800/90 text-blue-400 px-4 py-2 rounded-full shadow-lg border border-slate-700 flex items-center gap-2 font-bold animate-pulse backdrop-blur-md">
          <Navigation size={18} className="animate-spin" /> Locating...
        </div>
      )}

      {/* GPS Retry Button (Shows only if location fails/is denied) */}
      {gpsFailed && !isLocating && (
        <button 
          onClick={startAppTracking}
          className="absolute top-[calc(max(1rem,env(safe-area-inset-top))+4.5rem)] left-4 z-20 bg-red-600/90 hover:bg-red-500 text-white px-5 py-3 rounded-2xl shadow-[0_0_20px_rgba(220,38,38,0.4)] flex items-center gap-2 font-bold transition-all active:scale-95 backdrop-blur-md"
        >
          <MapPin size={20} /> Retry Location
        </button>
      )}
      {/* Recenter Button - Only shows when user has panned away */}
      {!isTracking && (
        <button 
          onClick={() => {
            console.log(isTracking);
            console.log("[Fog World] Recenter triggered, following user again.");
            if (mapInstanceRef.current && currentPos) {
              mapInstanceRef.current.flyTo(currentPos, BASE_ZOOM, { animate: true });
            }
            setIsTracking(true);
          }}
          className="absolute bottom-32 right-4 z-20 bg-blue-600 text-white p-4 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.3)] transition-all active:scale-90"
        >
          <Navigation size={24} />
        </button>
      )}
      <BottomControls
        setShowTeleportModal={setShowTeleportModal}
        showOnlyWiki={showOnlyWiki} setShowOnlyWiki={setShowOnlyWiki} manualMove={manualMove} STEP_SIZE={STEP_SIZE}
        debugMode={debugMode}
        onSearchLandmarks={searchLandmarks} isSearching={isSearching}
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
        searchRadius={searchRadius} setSearchRadius={setSearchRadius}
        minSearchRadius={MIN_SEARCH_RADIUS} maxSearchRadius={MAX_SEARCH_RADIUS}
        draftOsmTags={draftOsmTags} toggleOsmTag={toggleOsmTag} addOsmTag={addOsmTag}
        saveOsmTags={saveOsmTags} resetOsmTags={resetOsmTags}
      />
    </div>
  );
}