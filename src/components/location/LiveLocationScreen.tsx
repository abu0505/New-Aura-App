import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Map, { Marker, Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { PartnerProfile } from '../../hooks/usePartner';

// ── Constants ──────────────────────────────────────────────────────────────────
// liberty style has far richer POI labels than dark (restaurants, shops, landmarks)
// and still looks clean on dark backgrounds. Tiles are CDN-cached globally.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

// ── Map controller ──────────────────────────────────────────────────────────────
// Handles smooth flyTo and missing image errors. Runs inside Map context.
function MapController({ center }: { center: { lat: number; lng: number } | null }) {
  const { current: map } = useMap();
  const prevRef = useRef<{ lat: number; lng: number } | null>(null);
  const firstFlyRef = useRef(false);

  useEffect(() => {
    if (!map || !center) return;
    const prev = prevRef.current;
    // Skip update if moved < ~8m to avoid constant recentering while user pans
    if (prev && Math.abs(prev.lat - center.lat) < 0.00007 && Math.abs(prev.lng - center.lng) < 0.00007) return;
    prevRef.current = center;
    // First fly is instant (no animation), subsequent ones are smooth
    map.flyTo({
      center: [center.lng, center.lat],
      duration: firstFlyRef.current ? 1200 : 0,
      essential: true,
    });
    firstFlyRef.current = true;
    map.resize();
  }, [center?.lat, center?.lng, map]);

  useEffect(() => {
    if (!map) return;
    const handle = (e: any) => {
      try {
        if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
      } catch {}
    };
    map.on('styleimagemissing', handle);
    return () => { map.off('styleimagemissing', handle); };
  }, [map]);

  return null;
}

// ── PFP Marker (memoised — no re-render on map pan) ────────────────────────────
function PfpMarker({ avatarUrl, name, isPartner }: { avatarUrl: string; name: string; isPartner: boolean }) {
  return (
    <div className="relative select-none" style={{ transform: 'translateZ(0)' }}>
      {isPartner && (
        <div
          className="absolute rounded-full border-2 border-[var(--gold)] opacity-25"
          style={{ inset: '-6px', animation: 'loc-ping 2s ease-in-out infinite' }}
        />
      )}
      <div className={`w-11 h-11 rounded-full overflow-hidden shadow-xl bg-[var(--bg-elevated)] ${isPartner ? 'border-[3px] border-[var(--gold)]' : 'border-[2px] border-white'}`}>
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
      </div>
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
        <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full shadow ${isPartner ? 'bg-[var(--gold)] text-[var(--on-accent)]' : 'bg-white text-black'}`}>
          {isPartner ? '♡' : 'You'}
        </span>
      </div>
    </div>
  );
}

// ── Route fetch ─────────────────────────────────────────────────────────────────
async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<GeoJSON.Feature<GeoJSON.LineString> | null> {
  try {
    const res = await fetch(
      `${OSRM_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.[0]) return null;
    return {
      type: 'Feature',
      geometry: json.routes[0].geometry,
      properties: { distance: json.routes[0].distance, duration: json.routes[0].duration },
    };
  } catch {
    return null;
  }
}

// ── Layer specs (defined outside component — no re-creation on render) ──────────
const ROUTE_CASING: any = {
  id: 'route-casing', type: 'line', source: 'route',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#0d0d15', 'line-width': 9, 'line-opacity': 0.85 },
};
const ROUTE_LINE: any = {
  id: 'route-line', type: 'line', source: 'route',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: { 'line-color': '#c9a96e', 'line-width': 4.5, 'line-dasharray': [2.5, 1.5] },
};

// ── Props ────────────────────────────────────────────────────────────────────────
interface LiveLocationScreenProps {
  partner: PartnerProfile | null;
  isActive: boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
export default function LiveLocationScreen({ partner, isActive }: LiveLocationScreenProps) {
  const { user } = useAuth();
  const { userLocation, partnerLocation, isSharing, startSharing, stopSharing, error, distanceKm } =
    useLiveLocation(isActive);

  // ── Lazy mount guard ──────────────────────────────────────────────────────────
  // Map GL context is expensive. Don't mount until the user actually opens this tab.
  // Once mounted, keep it (avoids reload on tab switch).
  const [hasBeenActive, setHasBeenActive] = useState(false);
  useEffect(() => {
    if (isActive && !hasBeenActive) setHasBeenActive(true);
  }, [isActive, hasBeenActive]);

  // ── Avatars ───────────────────────────────────────────────────────────────────
  const [myAvatar, setMyAvatar] = useState('');
  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('avatar_url,display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMyAvatar(
          data?.avatar_url ||
            `https://ui-avatars.com/api/?name=${data?.display_name ?? 'Me'}&background=ffffff&color=13131b`
        );
      });
  }, [user?.id]);

  const partnerAvatar =
    partner?.avatar_url ||
    `https://ui-avatars.com/api/?name=${partner?.display_name ?? 'P'}&background=c9a96e&color=13131b`;

  // ── Map viewState — RAF debounced for smooth panning without extra renders ─────
  const [viewState, setViewState] = useState({ longitude: 72.8777, latitude: 21.1702, zoom: 15.5, pitch: 0, bearing: 0 });
  const rafRef = useRef<number | null>(null);
  const handleMove = useCallback((evt: any) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setViewState(evt.viewState));
  }, []);

  const mapCenter = useMemo(() => {
    if (userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    if (partnerLocation) return { lat: partnerLocation.lat, lng: partnerLocation.lng };
    return null;
  }, [userLocation?.lat, userLocation?.lng, partnerLocation?.lat, partnerLocation?.lng]);

  // ── Zoom controls ─────────────────────────────────────────────────────────────
  const mapRef = useRef<MapLibreMap | null>(null);
  const zoomIn  = useCallback(() => mapRef.current?.zoomIn ({ duration: 250 }), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut({ duration: 250 }), []);

  // ── Route ─────────────────────────────────────────────────────────────────────
  const [routeGeoJSON, setRouteGeoJSON] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ dist: string; dur: string } | null>(null);

  const handleNavigate = useCallback(async () => {
    if (!userLocation || !partnerLocation) return;
    if (routeGeoJSON) { setRouteGeoJSON(null); setRouteInfo(null); return; }
    setRouteLoading(true);
    const route = await fetchRoute(userLocation, partnerLocation);
    setRouteLoading(false);
    if (!route) return;
    setRouteGeoJSON(route);
    setRouteInfo({
      dist: ((route.properties!.distance) / 1000).toFixed(1),
      dur: Math.ceil(route.properties!.duration / 60).toString(),
    });
    if (mapRef.current) {
      const coords = route.geometry.coordinates as [number, number][];
      const lngs = coords.map(c => c[0]);
      const lats  = coords.map(c => c[1]);
      mapRef.current.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 110, bottom: 190, left: 60, right: 60 }, duration: 1100 }
      );
    }
  }, [userLocation, partnerLocation, routeGeoJSON]);

  const canNavigate = !!userLocation && !!partnerLocation;

  // ── Status text ───────────────────────────────────────────────────────────────
  const statusText = distanceKm
    ? `${distanceKm} km apart`
    : isSharing
    ? 'Live'
    : 'Private';

  return (
    <div className="h-full w-full relative overflow-hidden bg-[#0d0d15]" style={{ contain: 'strict' }}>

      {/* ── Map (lazy mounted) ──────────────────────────────────────────────── */}
      {hasBeenActive && (
        <div className="absolute inset-0 z-0">
          <Map
            {...viewState}
            onMove={handleMove}
            mapStyle={MAP_STYLE}
            style={{ width: '100%', height: '100%' }}
            maxPitch={0}
            dragRotate={false}
            touchZoomRotate={true}
            cooperativeGestures={false}
            attributionControl={false}
            onError={() => {}}
            maxTileCacheSize={30}
            ref={(r) => { if (r) mapRef.current = r.getMap(); }}
          >
            <MapController center={mapCenter} />

            {routeGeoJSON && (
              <Source id="route" type="geojson" data={routeGeoJSON}>
                <Layer {...ROUTE_CASING} />
                <Layer {...ROUTE_LINE} />
              </Source>
            )}

            {userLocation && (
              <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="bottom" style={{ zIndex: 10 }}>
                <PfpMarker avatarUrl={myAvatar} name="You" isPartner={false} />
              </Marker>
            )}

            {partnerLocation && (
              <Marker longitude={partnerLocation.lng} latitude={partnerLocation.lat} anchor="bottom" style={{ zIndex: 20 }}>
                <PfpMarker avatarUrl={partnerAvatar} name={partner?.display_name ?? 'P'} isPartner />
              </Marker>
            )}
          </Map>
        </div>
      )}

      {/* ── Desktop Zoom buttons (left side, hidden on mobile) ──────────────── */}
      <div className="hidden lg:flex absolute left-4 top-1/2 -translate-y-1/2 z-[200] flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={zoomIn}
          aria-label="Zoom in"
          className="w-9 h-9 rounded-xl bg-[rgba(20,20,36,0.88)] backdrop-blur border border-white/8 text-white/60 hover:text-white hover:bg-[rgba(20,20,36,1)] flex items-center justify-center transition-all active:scale-90 shadow-lg"
        >
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
        <button
          onClick={zoomOut}
          aria-label="Zoom out"
          className="w-9 h-9 rounded-xl bg-[rgba(20,20,36,0.88)] backdrop-blur border border-white/8 text-white/60 hover:text-white hover:bg-[rgba(20,20,36,1)] flex items-center justify-center transition-all active:scale-90 shadow-lg"
        >
          <span className="material-symbols-outlined text-lg">remove</span>
        </button>
      </div>

      {/* ── Minimal Header ──────────────────────────────────────────────────── */}
      <header
        className="absolute top-0 left-0 right-0 z-[100] px-3 pointer-events-none"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Left pill: title + status */}
          <div className="bg-[rgba(16,16,28,0.82)] backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/6 shadow-xl pointer-events-auto flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <p className="font-serif italic text-[var(--gold)] text-base leading-none tracking-tight">Our Location</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {isSharing && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />}
                <p className="text-white/40 text-[9px] uppercase tracking-widest font-bold">{statusText}</p>
              </div>
            </div>
            {error && (
              <p className="text-red-400 text-[9px] truncate flex-shrink-0">{error}</p>
            )}
          </div>

          {/* Right pill: share toggle */}
          <button
            onClick={isSharing ? stopSharing : startSharing}
            className={`pointer-events-auto flex-shrink-0 h-9 px-3.5 rounded-2xl font-bold tracking-widest uppercase text-[8px] transition-all duration-300 shadow-xl flex items-center gap-1.5 ${
              isSharing
                ? 'bg-[var(--gold)] text-[var(--on-accent)]'
                : 'bg-[rgba(16,16,28,0.82)] backdrop-blur-xl text-white/35 border border-white/6'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSharing ? 'bg-[var(--on-accent)] animate-pulse' : 'bg-white/15'}`} />
            {isSharing ? 'Live' : 'Off'}
          </button>
        </div>
      </header>

      {/* ── Bottom Card ─────────────────────────────────────────────────────── */}
      <footer
        className="absolute bottom-0 left-0 right-0 z-[100] px-3 pointer-events-none"
        style={{ paddingBottom: 'max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))' }}
      >
        <div className="bg-[rgba(16,16,28,0.88)] backdrop-blur-2xl rounded-3xl border border-white/6 shadow-2xl overflow-hidden pointer-events-auto">

          {/* Route info strip */}
          {routeInfo && (
            <div className="flex items-center justify-between px-4 py-2 bg-[var(--gold)]/8 border-b border-[var(--gold)]/15">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[var(--gold)] font-bold text-xs">{routeInfo.dist} km</p>
                  <p className="text-white/30 text-[8px] uppercase tracking-wider">Road dist</p>
                </div>
                <div className="w-px h-5 bg-white/8" />
                <div>
                  <p className="text-[var(--gold)] font-bold text-xs">{routeInfo.dur} min</p>
                  <p className="text-white/30 text-[8px] uppercase tracking-wider">Drive</p>
                </div>
              </div>
              <button
                onClick={() => { setRouteGeoJSON(null); setRouteInfo(null); }}
                className="text-white/25 hover:text-white/60 text-[9px] uppercase tracking-widest font-bold transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          {/* Partner row */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`flex-shrink-0 w-10 h-10 rounded-full border-2 transition-colors duration-500 ${partnerLocation ? 'border-[var(--gold)]' : 'border-white/10'}`}>
                <img
                  src={partnerAvatar}
                  alt={partner?.display_name ?? 'Partner'}
                  className={`w-full h-full object-cover rounded-full transition-all duration-500 ${!partnerLocation ? 'grayscale opacity-35' : ''}`}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="min-w-0">
                <p className={`font-serif italic text-sm leading-tight truncate transition-colors duration-500 ${partnerLocation ? 'text-[var(--gold)]' : 'text-white/25'}`}>
                  {partner?.display_name ?? 'Partner'}
                </p>
                <p className="text-white/30 text-[8px] uppercase tracking-widest font-bold mt-0.5">
                  {partnerLocation ? '● Live' : '○ Hidden'}
                </p>
              </div>
            </div>

            {/* Navigate btn */}
            <button
              onClick={handleNavigate}
              disabled={!canNavigate || routeLoading}
              className={`flex-shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-2xl font-bold text-[9px] uppercase tracking-widest transition-all duration-250 ${
                canNavigate
                  ? routeGeoJSON
                    ? 'bg-[var(--gold)] text-[var(--on-accent)]'
                    : 'bg-[rgba(201,169,110,0.1)] text-[var(--gold)] hover:bg-[rgba(201,169,110,0.18)] active:scale-95'
                  : 'bg-white/4 text-white/12 cursor-not-allowed'
              }`}
            >
              {routeLoading ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--gold)]/25 border-t-[var(--gold)] animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-sm">
                  {routeGeoJSON ? 'close' : 'near_me'}
                </span>
              )}
              {routeGeoJSON ? 'Cancel' : routeLoading ? '…' : 'Route'}
            </button>
          </div>
        </div>
      </footer>

      {/* ── Start sharing nudge ──────────────────────────────────────────────── */}
      {!isSharing && !userLocation && isActive && hasBeenActive && (
        <div className="absolute inset-0 z-[50] flex items-center justify-center">
          <div className="bg-[rgba(16,16,28,0.92)] backdrop-blur-2xl rounded-3xl border border-white/6 px-7 py-6 text-center max-w-[280px] mx-4 shadow-2xl">
            <span className="material-symbols-outlined text-[2.5rem] text-[var(--gold)] mb-2.5 block">location_on</span>
            <h2 className="font-serif italic text-lg text-white mb-1">Share Your Location</h2>
            <p className="text-white/35 text-xs leading-relaxed mb-4">Let her always find her way back to you.</p>
            <button
              onClick={startSharing}
              className="bg-[var(--gold)] text-[var(--on-accent)] px-7 py-2.5 rounded-2xl font-bold text-[10px] uppercase tracking-widest w-full active:scale-95 transition-transform"
            >
              Start Sharing
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loc-ping {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50%       { transform: scale(1.35); opacity: 0; }
        }
        .maplibregl-canvas { outline: none !important; }
        .maplibregl-ctrl-attrib { display: none !important; }
        .maplibregl-ctrl-bottom-right,
        .maplibregl-ctrl-bottom-left { display: none !important; }
      `}} />
    </div>
  );
}
