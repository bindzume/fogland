import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navigation, Sparkles } from 'lucide-react';

// Extracted UI Components
import TopStatus from './components/TopStatus';
import BottomControls from './components/BottomControls';
import TeleportModal from './components/TeleportModal';
import ProfileOverlay from './components/ProfileOverlay';

const BASE_ZOOM = 16;
const STEP_SIZE = 0.00015; // Roughly 15 meters per D-Pad tap
const ERASER_WIDTH_KM = 0.020;
const COLLECTION_RADIUS_KM = 0.015; // 15 meters to collect for point landmarks
const VIEW_HALF_SIZE = 0.01; // roughly 1.1km box trigger
const CELL_SIZE = 0.0005; // ~55m grid size for tracking boundary exploration
const MIN_EXPLORE_PERCENT = 0.05

const FALLBACK_LAT = 37.7799;
const FALLBACK_LNG = -121.9780;

// Helper: Calculate distance between two coords in km safely
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

// Helper: Estimate polygonal area from a Bounding Box
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

  const pathRef = useRef([]);
  const visitedCellsRef = useRef(new Set()); // For tracking area explored in parks
  const lastFetchBoxRef = useRef(null);

  const nearbyLandmarksRef = useRef([]);
  const collectedLandmarksRef = useRef([]);

  const [currentPos, setCurrentPos] = useState(null);
  const [isLocating, setIsLocating] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [gpsActive, setGpsActive] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  // Teleport State
  const [showTeleportModal, setShowTeleportModal] = useState(false);
  const [teleportQuery, setTeleportQuery] = useState('');
  const [isTeleporting, setIsTeleporting] = useState(false);

  // Wiki Filter State
  const [showOnlyWiki, setShowOnlyWiki] = useState(false);
  const showOnlyWikiRef = useRef(false);

  // Profile & Collectibles State
  const [showProfile, setShowProfile] = useState(false);
  const [showConfirmWipe, setShowConfirmWipe] = useState(false);
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'bag'
  const [geoData, setGeoData] = useState(null);
  const [stats, setStats] = useState({ distance: 0, areaKm: 0 });
  const [regionalAreas, setRegionalAreas] = useState({ country: null, state: null, local: null });

  const [nearbyLandmarks, setNearbyLandmarks] = useState([]);
  const [collectedLandmarks, setCollectedLandmarks] = useState([]);
  const [justCollected, setJustCollected] = useState(null);

  // 1. Load Data
  useEffect(() => {
    console.log("[Fog World] Initializing App and loading data...");
    try {
      const savedPath = localStorage.getItem('fogWorldLivePath');
      if (savedPath) {
        const parsed = JSON.parse(savedPath);
        if (Array.isArray(parsed)) {
          pathRef.current = parsed.filter(p => p === null || (Array.isArray(p) && p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])));
          console.log(`[Fog World] Loaded ${pathRef.current.length} path points from storage.`);

          // Hydrate visited cells for boundary exploration
          const cells = new Set();
          pathRef.current.forEach(p => {
            if (p && Array.isArray(p) && p.length === 2) {
              cells.add(`${Math.floor(p[0] / CELL_SIZE)}_${Math.floor(p[1] / CELL_SIZE)}`);
            }
          });
          visitedCellsRef.current = cells;
          console.log(`[Fog World] Hydrated ${cells.size} unique explored grid cells.`);
        }
      }
    } catch (e) { console.warn("[Fog World] Error parsing path data:", e); }

    try {
      const savedBag = localStorage.getItem('fogWorldCollected');
      if (savedBag) {
        const parsedBag = JSON.parse(savedBag);
        if (Array.isArray(parsedBag)) {
          setCollectedLandmarks(parsedBag);
          console.log(`[Fog World] Loaded ${parsedBag.length} collected items from bag.`);
        }
      }
    } catch (e) { console.warn("[Fog World] Error parsing bag data:", e); }

    if ('geolocation' in navigator) {
      console.log("[Fog World] Requesting initial GPS position...");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log("[Fog World] GPS Success:", position.coords.latitude, position.coords.longitude);
          handleNewLocation([position.coords.latitude, position.coords.longitude]);
          setIsLocating(false);
        },
        (error) => {
          console.warn("[Fog World] GPS Blocked or Failed. Using fallback. Error:", error.message);
          setLocationError(`GPS Error: ${error.message}. Using fallback.`);
          handleNewLocation([FALLBACK_LAT, FALLBACK_LNG]);
          setIsLocating(false);
          setGpsActive(false);
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    } else {
      console.warn("[Fog World] Geolocation API not supported in this browser.");
      setLocationError("Geolocation not supported.");
      handleNewLocation([FALLBACK_LAT, FALLBACK_LNG]);
      setIsLocating(false);
      setGpsActive(false);
    }
  }, []);

  // 2. Watch Real GPS
  useEffect(() => {
    if (!gpsActive || isLocating) {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      return;
    }
    console.log("[Fog World] Setting up GPS Watch...");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        handleNewLocation([position.coords.latitude, position.coords.longitude]);
      },
      (error) => console.warn("[Fog World] GPS Watch error:", error),
      { enableHighAccuracy: true, distanceFilter: 5 }
    );
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [gpsActive, isLocating]);


  // Drawing Fog Logic
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

      const currentZoom = map.getZoom();
      const scale = Math.pow(2, currentZoom - BASE_ZOOM);

      ctx.lineWidth = 50 * scale;

      ctx.beginPath();
      let isFirst = true;

      for (let i = 0; i < pathRef.current.length; i++) {
        const p = pathRef.current[i];

        if (!p || !Array.isArray(p) || p.length !== 2) {
          isFirst = true;
          continue;
        }

        const point = map.latLngToContainerPoint(p);
        if (isFirst) {
          ctx.moveTo(point.x, point.y);
          isFirst = false;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();

      // Draw uncollected landmarks ON TOP of the fog
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '28px Arial';

      // Filter uncollected based on the wiki toggle ref
      const uncollected = nearbyLandmarksRef.current.filter(lm =>
        !collectedLandmarksRef.current.some(c => c.id === lm.id) &&
        (!showOnlyWikiRef.current || lm.wikipedia)
      );

      uncollected.forEach(lm => {
        const pt = map.latLngToContainerPoint([lm.lat, lm.lon]);
        if (pt.x > -50 && pt.x < canvas.width + 50 && pt.y > -50 && pt.y < canvas.height + 50) {

          if (lm.isBoundary) {
            // Boundary/Park Landmark
            const pct = Math.min(99, Math.floor(((lm.progressCount || 0) / lm.requiredCells) * 100));
            ctx.shadowColor = 'rgba(74, 222, 128, 1)'; // Emerald green glow
            ctx.shadowBlur = 20;
            ctx.fillText('⭐', pt.x, pt.y);
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#4ade80';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`${pct}% 🌲`, pt.x, pt.y - 20);
          } else {
            // Point Landmark
            ctx.shadowColor = 'rgba(250, 204, 21, 1)'; // Yellow glow
            ctx.shadowBlur = 20;
            ctx.fillText('⭐', pt.x, pt.y);
            ctx.shadowBlur = 0;
          }
        }
      });
    } catch (err) {
      console.warn("[Fog World] Fog draw error avoided:", err);
    }
  }, []);

  // Sync ref and trigger a map redraw when the wiki filter changes
  useEffect(() => {
    showOnlyWikiRef.current = showOnlyWiki;
    drawFog();
  }, [showOnlyWiki, drawFog]);
  
  useEffect(() => {
    nearbyLandmarksRef.current = nearbyLandmarks;
    drawFog();
  }, [nearbyLandmarks, drawFog]);

  useEffect(() => {
    collectedLandmarksRef.current = collectedLandmarks;
    drawFog();
  }, [collectedLandmarks, drawFog]);

  // Handle Location Updates
  const handleNewLocation = useCallback((newPos) => {
    try {
      if (!Array.isArray(newPos) || newPos.length !== 2) return;

      setCurrentPos(newPos);

      const updatedPath = [...pathRef.current, newPos];
      pathRef.current = updatedPath;

      try {
        localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath));
      } catch (storageErr) { }

      // Track cell visited for boundary coverage
      const cellId = `${Math.floor(newPos[0] / CELL_SIZE)}_${Math.floor(newPos[1] / CELL_SIZE)}`;
      let newlyExploredCell = false;

      if (!visitedCellsRef.current.has(cellId)) {
        visitedCellsRef.current.add(cellId);
        newlyExploredCell = true;
        console.log(`[Fog World] Explored new cell: ${cellId}`);
      }

      // If we explored a new piece of land, update progress for active boundary landmarks
      if (newlyExploredCell) {
        setNearbyLandmarks(prev => {
          let updated = false;
          const next = prev.map(lm => {
            if (lm.isBoundary && !collectedLandmarksRef.current.some(c => c.id === lm.id)) {
              // Direct coordinates check against bounding box handles negatives better than snapped grids
              if (newPos[0] >= lm.bounds.minlat && newPos[0] <= lm.bounds.maxlat &&
                newPos[1] >= lm.bounds.minlon && newPos[1] <= lm.bounds.maxlon) {

                updated = true;
                const newCount = (lm.progressCount || 0) + 1;
                console.log(`[Fog World] Boundary Progress on '${lm.name}': ${newCount} / ${lm.requiredCells} cells`);
                return { ...lm, progressCount: newCount };
              }
            }
            return lm;
          });
          return updated ? next : prev;
        });
      }

      if (markerRef.current) markerRef.current.setLatLng(newPos);
      if (mapInstanceRef.current) mapInstanceRef.current.setView(newPos, mapInstanceRef.current.getZoom(), { animate: true });

      drawFog();
    } catch (err) {
      console.warn("[Fog World] Location update error avoided:", err);
    }
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

      const query = `[out:json][timeout:25];
(
  nwr["tourism"~"museum|attraction|viewpoint|gallery|artwork|zoo|aquarium|yes"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["historic"~"monument|memorial|ruins|castle|archaeological_site|ship"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["natural"~"peak|waterfall|cave_entrance|spring"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["man_made"~"lighthouse|windmill|obelisk|watermill|tower"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["amenity"~"fountain|clock"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["leisure"~"park|nature_reserve|water_park|garden|stadium|marina"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
  nwr["boundary"~"protected_area|national_park"](${fetchMinLat},${fetchMinLon},${fetchMaxLat},${fetchMaxLon});
);
out center bb;`;

      console.log(`[Fog World] Fetching Overpass data. Box: ${fetchMinLat},${fetchMinLon} to ${fetchMaxLat},${fetchMaxLon}`);

      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.elements) {
            console.log(`[Fog World] Overpass returned ${data.elements.length} raw elements.`);

            const items = data.elements
              .filter(e => {
                if (!e.tags || !e.tags.name) return false;
                return true;
              })
              .map(e => {
                const isBoundaryType = e.tags.leisure || e.tags.boundary || (e.tags.historic && e.bounds);
                const isBoundary = isBoundaryType && !!e.bounds;

                let progressCount = 0;
                let requiredCells = 0;

                if (isBoundary) {
                  const widthCells = Math.abs(e.bounds.maxlon - e.bounds.minlon) / CELL_SIZE;
                  const heightCells = Math.abs(e.bounds.maxlat - e.bounds.minlat) / CELL_SIZE;
                  const bboxAreaCells = widthCells * heightCells;

                  requiredCells = Math.max(3, Math.min(100, Math.floor(bboxAreaCells * MIN_EXPLORE_PERCENT)));

                  for (let c of visitedCellsRef.current) {
                    const [cLatStr, cLonStr] = c.split('_');
                    const centerLat = (parseInt(cLatStr) + 0.5) * CELL_SIZE;
                    const centerLon = (parseInt(cLonStr) + 0.5) * CELL_SIZE;

                    if (centerLat >= e.bounds.minlat && centerLat <= e.bounds.maxlat &&
                      centerLon >= e.bounds.minlon && centerLon <= e.bounds.maxlon) {
                      progressCount++;
                    }
                  }
                }

                // Calculate the mathematical center of the bounding box if the center is missing
                let computedLat = e.lat || (e.center && e.center.lat);
                let computedLon = e.lon || (e.center && e.center.lon);

                if (computedLat == null && e.bounds) {
                  computedLat = (e.bounds.minlat + e.bounds.maxlat) / 2;
                }
                if (computedLon == null && e.bounds) {
                  computedLon = (e.bounds.minlon + e.bounds.maxlon) / 2;
                }

                // Find the specific type from OSM tags
                let rawType = 'Landmark';
                if (e.tags.natural) rawType = e.tags.natural;
                else if (e.tags.historic) rawType = e.tags.historic;
                else if (e.tags.man_made) rawType = e.tags.man_made;
                else if (e.tags.tourism) rawType = e.tags.tourism;
                else if (e.tags.amenity) rawType = e.tags.amenity;
                else if (e.tags.leisure) rawType = e.tags.leisure;
                else if (e.tags.boundary) rawType = e.tags.boundary;

                // Format it nicely
                const specificType = rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

                // Format Wikipedia Link
                let wikiLink = null;
                if (e.tags.wikipedia) {
                  const parts = e.tags.wikipedia.split(':');
                  if (parts.length === 2) {
                    wikiLink = `https://${parts[0]}.wikipedia.org/wiki/${encodeURIComponent(parts[1])}`;
                  }
                }

                const lm = {
                  id: e.id,
                  name: e.tags.name,
                  lat: computedLat,
                  lon: computedLon,
                  type: isBoundaryType ? 'park/boundary' : 'point',
                  specificType: specificType, 
                  description: e.tags.description || null, 
                  wikipedia: wikiLink, 
                  isBoundary,
                  bounds: e.bounds,
                  progressCount,
                  requiredCells,
                };

                return lm;
              })
              .filter(e => e.lat != null && e.lon != null);

            setNearbyLandmarks(prev => {
              const map = new Map();
              prev.forEach(lm => {
                if (getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon) < 10) map.set(lm.id, lm);
              });
              items.forEach(lm => map.set(lm.id, lm));
              return Array.from(map.values());
            });
          }
        })
        .catch(err => console.error("[Fog World] Overpass Fetch Failed:", err));
    }
  }, [currentPos]);

  // 4. Collect Nearby Landmarks
  useEffect(() => {
    if (!currentPos || !Array.isArray(currentPos)) return;

    nearbyLandmarks.forEach(async (lm) => {
      if (collectedLandmarks.some(c => c.id === lm.id)) return;

      let shouldCollect = false;

      if (lm.isBoundary) {
        if (lm.progressCount >= lm.requiredCells) {
          console.log(`[Fog World] Collecting Boundary '${lm.name}'`);
          shouldCollect = true;
        }
      } else {
        const dist = getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon);
        if (dist < COLLECTION_RADIUS_KM) {
          console.log(`[Fog World] Collecting Point '${lm.name}'`);
          shouldCollect = true;
        }
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
        } catch (e) { console.warn("[Fog World] Reverse geocode failed for collected item:", e); }
      }
    });
  }, [currentPos, nearbyLandmarks, collectedLandmarks]);

  // Initialize Map
  useEffect(() => {
    if (isLocating || mapInstanceRef.current || !currentPos) return;
    let isMounted = true;

    console.log("[Fog World] Initializing Leaflet map at:", currentPos);
    const initMap = async () => {
      try {
        if (!window.L) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
          await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
          });
        }

        if (!isMounted || mapInstanceRef.current || !window.L) return;

        const map = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView(currentPos, BASE_ZOOM);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

        const userIcon = window.L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
          iconSize: [16, 16], iconAnchor: [8, 8]
        });

        markerRef.current = window.L.marker(currentPos, { icon: userIcon }).addTo(map);
        mapInstanceRef.current = map;
        setMapReady(true);

        map.on('move', drawFog); map.on('zoom', drawFog); window.addEventListener('resize', drawFog);

        map.on('dblclick', (e) => {
          setGpsActive(false);
          const newPos = [e.latlng.lat, e.latlng.lng];
          const updatedPath = [...pathRef.current, null, newPos];
          pathRef.current = updatedPath;
          try { localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath)); } catch (err) { }
          handleNewLocation(newPos);
        });

        setTimeout(drawFog, 100);
      } catch (err) {
        console.warn("[Fog World] Failed to initialize map:", err);
      }
    };
    initMap();

    return () => {
      isMounted = false;
      window.removeEventListener('resize', drawFog);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        setMapReady(false);
      }
    };
  }, [isLocating, currentPos, drawFog, handleNewLocation]);

  // Controls
  const manualMove = (latOffset, lngOffset) => {
    if (!currentPos || !Array.isArray(currentPos)) return;
    setGpsActive(false);
    handleNewLocation([currentPos[0] + latOffset, currentPos[1] + lngOffset]);
  };

  const executeClearData = () => {
    console.log("[Fog World] Wiping user data...");
    try {
      pathRef.current = currentPos && Array.isArray(currentPos) ? [currentPos] : [];
      visitedCellsRef.current = new Set();
      localStorage.removeItem('fogWorldLivePath');
      localStorage.removeItem('fogWorldCollected');
      setCollectedLandmarks([]);
      collectedLandmarksRef.current = [];
      drawFog();
      setShowConfirmWipe(false);
      setShowProfile(false);
    } catch (e) { console.warn("[Fog World] Error wiping data:", e); }
  };

  // Export / Import Logic
  const handleExport = () => {
    const data = { path: pathRef.current, collected: collectedLandmarks };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fog-world-save-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        // Restore Path
        if (data.path && Array.isArray(data.path)) {
          pathRef.current = data.path;
          localStorage.setItem('fogWorldLivePath', JSON.stringify(data.path));

          const cells = new Set();
          data.path.forEach(p => {
            if (p && Array.isArray(p) && p.length === 2) {
              cells.add(`${Math.floor(p[0] / CELL_SIZE)}_${Math.floor(p[1] / CELL_SIZE)}`);
            }
          });
          visitedCellsRef.current = cells;
        }

        // Restore Bag
        if (data.collected && Array.isArray(data.collected)) {
          setCollectedLandmarks(data.collected);
          collectedLandmarksRef.current = data.collected;
          localStorage.setItem('fogWorldCollected', JSON.stringify(data.collected));
        }

        drawFog();
        alert("Save file imported successfully!");
      } catch (err) {
        console.error("[Fog World] Failed to parse save file:", err);
        alert("Invalid save file.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; // Reset input
  };

  // Teleport Logic
  const executeTeleport = async () => {
    if (!teleportQuery.trim()) return;
    setIsTeleporting(true);
    try {
      let lat, lon;
      const query = teleportQuery.trim();
      const coords = query.split(',').map(s => s.trim());

      if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
        lat = parseFloat(coords[0]);
        lon = parseFloat(coords[1]);
      } else {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
        const data = await res.json();
        if (data && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lon = parseFloat(data[0].lon);
        } else {
          alert("Location not found! Try a known city name.");
          setIsTeleporting(false);
          return;
        }
      }

      setGpsActive(false);
      const newPos = [lat, lon];

      const updatedPath = [...pathRef.current, null, newPos];
      pathRef.current = updatedPath;
      try { localStorage.setItem('fogWorldLivePath', JSON.stringify(updatedPath)); } catch (e) { }

      handleNewLocation(newPos);
      if (mapInstanceRef.current) mapInstanceRef.current.setView(newPos, mapInstanceRef.current.getZoom(), { animate: false });

      setShowTeleportModal(false);
      setTeleportQuery('');
    } catch (e) {
      alert("Teleportation failed.");
    }
    setIsTeleporting(false);
  };

  // Profile Open & Stats
  const fetchBBoxArea = async (query) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
      const data = await res.json();
      if (data && data[0] && data[0].boundingbox) return calcBBoxAreaKm2(data[0].boundingbox);
    } catch (e) { } return null;
  };

  const openProfile = async () => {
    setShowProfile(true);
    setRegionalAreas({ country: null, state: null, local: null });

    let totalDistKm = 0;
    const path = pathRef.current || [];
    for (let i = 1; i < path.length; i++) {
      if (path[i - 1] && path[i] && Array.isArray(path[i - 1]) && Array.isArray(path[i])) {
        totalDistKm += getDistanceKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
      }
    }
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

    if (country) {
      try {
        const cRes = await fetch(`https://restcountries.com/v3.1/name/${country}?fullText=true`);
        const cData = await cRes.json();
        if (cData && cData[0] && cData[0].area) setRegionalAreas(prev => ({ ...prev, country: cData[0].area }));
      } catch (e) { }
    }
    if (state) {
      const sArea = await fetchBBoxArea(`${state}, ${country}`);
      if (sArea) setRegionalAreas(prev => ({ ...prev, state: sArea }));
    }
    if (local) {
      setTimeout(async () => {
        const lArea = await fetchBBoxArea(`${local}, ${state}, ${country}`);
        if (lArea) setRegionalAreas(prev => ({ ...prev, local: lArea }));
      }, 1200);
    }
  };

  // Format data for the bag
  const visibleCollected = showOnlyWiki 
    ? (collectedLandmarks || []).filter(lm => lm.wikipedia) 
    : (collectedLandmarks || []);

  const groupedBag = Array.isArray(visibleCollected) ? visibleCollected.reduce((acc, lm) => {
    const country = lm.country || 'Unknown';
    const state = lm.state || 'Unknown';
    const city = lm.city || 'Unknown';
    if (!acc[country]) acc[country] = {};
    if (!acc[country][state]) acc[country][state] = {};
    if (!acc[country][state][city]) acc[country][state][city] = [];
    acc[country][state][city].push(lm);
    return acc;
  }, {}) : {};

  // Loading State
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

      {/* Toast Notification */}
      {justCollected && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-bounce pointer-events-none">
          <div className="bg-yellow-400 text-slate-900 font-bold px-6 py-3 rounded-full shadow-[0_0_30px_rgba(250,204,21,0.5)] flex items-center gap-2 border-2 border-yellow-200">
            <Sparkles size={20} className="text-white fill-white" />
            Found: {justCollected}!
          </div>
        </div>
      )}

      {/* Map Layers */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />
      <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full pointer-events-none" />

      {/* Extracted UI Components */}
      <TopStatus 
        locationError={locationError} 
        openProfile={openProfile} 
      />

      <BottomControls 
        gpsActive={gpsActive}
        setGpsActive={setGpsActive}
        setShowTeleportModal={setShowTeleportModal}
        showOnlyWiki={showOnlyWiki}
        setShowOnlyWiki={setShowOnlyWiki}
        manualMove={manualMove}
        STEP_SIZE={STEP_SIZE}
      />

      <TeleportModal 
        showTeleportModal={showTeleportModal}
        setShowTeleportModal={setShowTeleportModal}
        teleportQuery={teleportQuery}
        setTeleportQuery={setTeleportQuery}
        executeTeleport={executeTeleport}
        isTeleporting={isTeleporting}
      />

      <ProfileOverlay 
        showProfile={showProfile}
        setShowProfile={setShowProfile}
        handleImport={handleImport}
        handleExport={handleExport}
        fileInputRef={fileInputRef}
        showConfirmWipe={showConfirmWipe}
        setShowConfirmWipe={setShowConfirmWipe}
        executeClearData={executeClearData}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        geoData={geoData}
        regionalAreas={regionalAreas}
        groupedBag={groupedBag}
        visibleCollectedCount={Array.isArray(visibleCollected) ? visibleCollected.length : 0}
        showOnlyWiki={showOnlyWiki}
      />

    </div>
  );
}