import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Navigation, Crosshair, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, User, X, Globe, Activity, Backpack, Star, Sparkles, Rocket, Search, Trees, Download, Upload, Book } from 'lucide-react';

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

  // NEW: Wiki Filter State
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

      // NEW: Filter uncollected based on the wiki toggle ref
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

                // CRITICAL FIX: Sometimes Overpass doesn't return a "center" node for complex relations/polygons.
                // We must calculate the mathematical center of the bounding box if the center is missing!
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

                // Format it nicely (e.g., "cave_entrance" -> "Cave Entrance")
                const specificType = rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

                // Format Wikipedia Link (OSM usually formats this as "en:Article_Name")
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
                  type: isBoundaryType ? 'park/boundary' : 'point', // Keeping this simple for your existing logic
                  specificType: specificType, // NEW: The exact type (Tower, Peak, etc.)
                  description: e.tags.description || null, // NEW: Brief description
                  wikipedia: wikiLink, // NEW: Wikipedia URL
                  isBoundary,
                  bounds: e.bounds,
                  progressCount,
                  requiredCells,
                };

                if (isBoundary) {
                  console.log(`[Fog World] Boundary Identified: '${lm.name}' | Center Coord assigned: ${computedLat}, ${computedLon}`);
                }

                return lm;
              })
              // Now that we fallback to the bounding box center, this filter won't accidentally delete parks!
              .filter(e => e.lat != null && e.lon != null);

            console.log(`[Fog World] Processed ${items.length} valid named landmarks in area.`);

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
          console.log(`[Fog World] Collecting Boundary '${lm.name}' (Progress met: ${lm.progressCount} >= ${lm.requiredCells})`);
          shouldCollect = true;
        }
      } else {
        const dist = getDistanceKm(currentPos[0], currentPos[1], lm.lat, lm.lon);
        if (dist < COLLECTION_RADIUS_KM) {
          console.log(`[Fog World] Collecting Point '${lm.name}' (Distance: ${dist.toFixed(4)}km < ${COLLECTION_RADIUS_KM}km)`);
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
          console.log("[Fog World] Double click teleport to:", e.latlng.lat, e.latlng.lng);
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
    const data = {
      path: pathRef.current,
      collected: collectedLandmarks
    };
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

          // Re-hydrate explored grid cells
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
    console.log(`[Fog World] Attempting teleport to: ${teleportQuery}`);
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
          console.log(`[Fog World] Teleport geocode success: ${data[0].display_name}`);
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
      console.warn("[Fog World] Teleportation failed:", e);
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
    console.log("[Fog World] Opening Profile...");
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
    } catch (e) { console.warn("[Fog World] Reverse geocoding failed for profile area:", e); return; }

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

  // NEW: Filter collected list before rendering bag
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

      <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />
      <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full pointer-events-none" />

      {/* Top Status */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
        <div className="bg-white/95 backdrop-blur-xl p-3 rounded-2xl shadow-xl border border-slate-100 pointer-events-auto">
          <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
            <MapPin className="text-blue-500" size={16} /> Fog World
          </h3>
          {locationError && <p className="text-[10px] text-red-500 mt-1">{locationError}</p>}
        </div>
        <div className="pointer-events-auto">
          <button onClick={openProfile} className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-2xl shadow-xl transition-colors active:scale-95 flex items-center gap-2 font-semibold">
            <User size={18} />
          </button>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-6 left-4 right-4 z-20 flex justify-between items-end pointer-events-none">

        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl p-3 rounded-3xl shadow-2xl border border-slate-100 flex flex-col gap-2">
          <button onClick={() => setGpsActive(!gpsActive)} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-semibold transition-all active:scale-95 ${gpsActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-100 text-slate-600'}`}>
            <Crosshair size={18} className={gpsActive ? "animate-pulse" : ""} /> {gpsActive ? "Live GPS" : "GPS Off"}
          </button>

          <button onClick={() => setShowTeleportModal(true)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all active:scale-95 bg-purple-100 text-purple-700 hover:bg-purple-200">
            <Rocket size={18} /> Teleport
          </button>

          {/* NEW: Wiki Filter Toggle */}
          <button onClick={() => setShowOnlyWiki(!showOnlyWiki)} className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all active:scale-95 ${showOnlyWiki ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            <Book size={18} /> {showOnlyWiki ? "Wiki Only" : "All Sites"}
          </button>
        </div>

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
      </div>

      {/* TELEPORT MODAL */}
      {showTeleportModal && (
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
      )}

      {/* PROFILE OVERLAY */}
      {showProfile && (
        <div className="absolute inset-0 z-50 bg-slate-900/95 backdrop-blur-md overflow-y-auto">

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            accept=".json"
            className="hidden"
          />

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
                <Activity size={16} /> Map Stats
              </button>
              <button onClick={() => setActiveTab('bag')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${activeTab === 'bag' ? 'bg-yellow-500 text-slate-900 shadow-md' : 'text-slate-400 hover:text-white'}`}>
                <Backpack size={16} /> Landmarks Bag ({Array.isArray(visibleCollected) ? visibleCollected.length : 0})
              </button>
            </div>

            {/* TAB: STATS */}
            {activeTab === 'stats' && (
              <div className="space-y-6">
                <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700">
                  <div className="flex items-center gap-3 mb-4"><Globe className="text-green-400" size={24} /> <h3 className="text-xl font-semibold">World Overview</h3></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900/50 p-4 rounded-2xl">
                      <div className="text-sm text-slate-400 mb-1">Total Distance</div>
                      <div className="text-xl font-mono font-bold text-white">{stats.distance < 1 ? (stats.distance * 1000).toFixed(0) + ' m' : stats.distance.toFixed(2) + ' km'}</div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-2xl">
                      <div className="text-sm text-slate-400 mb-1">Cleared Area</div>
                      <div className="text-xl font-mono font-bold text-blue-400">{stats.areaKm < 1 ? (stats.areaKm * 1000000).toFixed(0) + ' m²' : stats.areaKm.toFixed(3) + ' km²'}</div>
                    </div>
                  </div>
                </div>

                <h3 className="text-lg font-semibold px-2 flex items-center gap-2"><MapPin className="text-purple-400" /> Regional Data</h3>
                {!geoData ? (
                  <div className="text-center p-8 text-slate-500 bg-slate-800/50 rounded-3xl border border-slate-700 border-dashed">
                    <Activity className="animate-spin mx-auto mb-3 opacity-50" size={32} /> Scanning topography...
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                      <div className="flex justify-between mb-2"><div><div className="text-xs text-slate-500 uppercase">Country</div><div className="text-lg font-semibold">{geoData.country}</div></div></div>
                      {regionalAreas.country && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.country) * 100).toFixed(6)}% Unlocked</div>}
                    </div>
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                      <div className="flex justify-between mb-2"><div><div className="text-xs text-slate-500 uppercase">State</div><div className="text-lg font-semibold">{geoData.state}</div></div></div>
                      {regionalAreas.state && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.state) * 100).toFixed(6)}% Unlocked</div>}
                    </div>
                    <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700/50">
                      <div className="flex justify-between mb-2"><div><div className="text-xs text-slate-500 uppercase">City</div><div className="text-lg font-semibold">{geoData.city}</div></div></div>
                      {regionalAreas.local && <div className="text-xs text-green-400 font-mono">{((stats.areaKm / regionalAreas.local) * 100).toFixed(6)}% Unlocked</div>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB: BAG */}
            {activeTab === 'bag' && (
              <div className="bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-700 min-h-[400px]">
                {!visibleCollected || visibleCollected.length === 0 ? (
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

                                        {/* New Details Section */}
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

          </div>
        </div>
      )}

    </div>
  );
}