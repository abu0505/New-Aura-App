import { useState, useMemo, useEffect } from 'react';
import Map, { Marker, NavigationControl, Layer, useMap } from 'react-map-gl/maplibre';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import type { PartnerProfile } from '../../hooks/usePartner';

// Style constants
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

// 2D buildings layer config - optimized for visibility and speed
const buildingsLayer: any = {
  id: 'buildings-2d',
  source: 'openmaptiles',
  'source-layer': 'building',
  type: 'fill',
  minzoom: 13, // Show buildings earlier
  paint: {
    'fill-color': [
      'interpolate',
      ['linear'],
      ['zoom'],
      13, '#2a2a35', // Lighter than background (which is #0d0d15)
      16, '#3a3a45'
    ],
    'fill-outline-color': '#4a4a55',
    'fill-opacity': 0.9
  }
};

// Helper to handle camera movements and resizing
function MapController({ center }: { center: { lat: number, lng: number } }) {
  const { current: map } = useMap();

  useEffect(() => {
    if (map) {
      map.flyTo({ 
        center: [center.lng, center.lat], 
        duration: 2000,
        essential: true 
      });
      // Force resize to handle potential hidden tab mounting
      map.resize();
    }
  }, [center.lat, center.lng, map]);

  useEffect(() => {
    if (map) {
      const handleMissingImage = (e: any) => {
        const id = e.id;
        try {
          if (!map.hasImage(id)) {
            map.addImage(id, { width: 1, height: 1, data: new Uint8Array([0,0,0,0]) });
          }
        } catch (err) {}
      };
      
      map.on('styleimagemissing', handleMissingImage);
      return () => {
        map.off('styleimagemissing', handleMissingImage);
      };
    }
  }, [map]);

  return null;
}

interface LiveLocationScreenProps {
  partner: PartnerProfile | null;
}

export default function LiveLocationScreen({ partner }: LiveLocationScreenProps) {
  const { 
    userLocation, 
    partnerLocation, 
    isSharing, 
    startSharing, 
    stopSharing, 
    error, 
    distanceKm 
  } = useLiveLocation();

  const [viewState, setViewState] = useState({
    longitude: 72.8777, // Surat, India
    latitude: 21.1702,
    zoom: 16, // Start closer to see buildings
    pitch: 0,
    bearing: 0
  });

  const toggleSharing = () => {
    if (isSharing) {
      stopSharing();
    } else {
      startSharing();
    }
  };

  const mapCenter = useMemo(() => {
    if (userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    if (partnerLocation) return { lat: partnerLocation.lat, lng: partnerLocation.lng };
    return { lat: 21.1702, lng: 72.8777 }; // Surat fallback
  }, [userLocation, partnerLocation]);

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] relative overflow-hidden flex flex-col font-sans map-gpu-container">
      {/* Header Overlay */}
      <header className="absolute top-0 left-0 w-full z-[1000] p-6 lg:p-12 pointer-events-none">
        <div className="flex justify-between items-start w-full gap-4">
          <div className="bg-[var(--bg-elevated)]/80 backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl pointer-events-auto flex-1 min-w-[200px] max-w-sm">
            <h1 className="font-serif italic text-3xl text-[var(--gold)] mb-1">Our Sanctuary</h1>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] animate-pulse"></span>
              <p className="text-white/60 text-xs uppercase tracking-widest font-bold">
                {distanceKm ? `${distanceKm} km apart` : 'Live Synchronicity'}
              </p>
            </div>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>

          <button 
            onClick={toggleSharing}
            className={`pointer-events-auto px-6 py-3 rounded-full font-label font-bold tracking-widest uppercase text-[10px] transition-all duration-500 shadow-2xl flex items-center gap-3 ${isSharing ? 'bg-[var(--gold)] text-[var(--on-accent)]' : 'bg-[var(--bg-elevated)] text-white/40 border border-white/5'}`}
          >
            <span className={`w-2 h-2 rounded-full ${isSharing ? 'bg-[var(--on-accent)] animate-pulse' : 'bg-white/20'}`}></span>
            {isSharing ? 'SHARING LOCATION' : 'LOCATION PRIVATE'}
          </button>
        </div>
      </header>

      {/* Map Container */}
      <div className="flex-1 z-0 relative h-full w-full">
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          maxPitch={0} // Force 2D
          dragRotate={false} // Disable rotation for 2D simplicity
          touchZoomRotate={false}
          cooperativeGestures={false}
          onError={(e) => console.error('MapLibre error:', e)}
          attributionControl={false}
        >
          <MapController center={mapCenter} />
          
          {/* 3D Building Layer */}
          <Layer {...buildingsLayer} />

          {/* User Marker */}
          {userLocation && (
            <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="bottom">
              <div className="w-8 h-8 bg-white rounded-full border-2 border-[var(--bg-secondary)] flex items-center justify-center shadow-2xl cursor-pointer hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[var(--bg-secondary)] text-sm">home</span>
              </div>
            </Marker>
          )}

          {/* Partner Marker */}
          {partnerLocation && (
            <Marker longitude={partnerLocation.lng} latitude={partnerLocation.lat} anchor="center">
              <div className="relative cursor-pointer hover:scale-110 transition-transform">
                <div className="w-10 h-10 rounded-full border-2 border-[var(--gold)] overflow-hidden shadow-2xl bg-[var(--bg-elevated)]">
                  <img 
                    src={partner?.avatar_url || `https://ui-avatars.com/api/?name=${partner?.display_name || 'P'}&background=c9a96e&color=13131b`} 
                    className="w-full h-full object-cover" 
                    alt="Partner"
                  />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--gold)] rounded-full flex items-center justify-center shadow-lg">
                  <span className="material-symbols-outlined text-[var(--on-accent)] text-[10px] font-bold">favorite</span>
                </div>
              </div>
            </Marker>
          )}

          <NavigationControl position="top-right" showCompass={true} />
        </Map>
      </div>

      {/* Bottom Info Bar */}
      <footer className="absolute bottom-12 left-0 w-full z-[1000] px-6 lg:px-12 pointer-events-none">
        <div className="max-w-md mx-auto bg-[var(--bg-elevated)]/80 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 shadow-3xl pointer-events-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className={`w-14 h-14 rounded-full border-2 p-1 transition-colors duration-500 ${partnerLocation ? 'border-[var(--gold)]' : 'border-white/10'}`}>
              <img 
                src={partner?.avatar_url || `https://ui-avatars.com/api/?name=${partner?.display_name || 'P'}&background=c9a96e&color=13131b`} 
                alt="Partner" 
                className={`w-full h-full object-cover rounded-full transition-all duration-500 ${!partnerLocation && 'grayscale opacity-50'}`} 
              />
            </div>
            <div>
              <p className={`font-serif italic text-lg leading-tight transition-colors duration-500 ${partnerLocation ? 'text-[var(--gold)]' : 'text-white/40'}`}>
                {partner?.display_name || 'Partner'}
              </p>
              <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mt-1">
                {partnerLocation ? 'LIVE LOCATION ACTIVE' : 'LOCATION HIDDEN'}
              </p>
            </div>
          </div>
          
          <button 
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${partnerLocation ? 'bg-[rgba(var(--primary-rgb),_0.1)] text-[var(--gold)] hover:bg-[rgba(var(--primary-rgb),_0.2)]' : 'bg-white/5 text-white/20'}`}
            disabled={!partnerLocation}
          >
            <span className="material-symbols-outlined">navigation</span>
          </button>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        .map-gpu-container {
          transform: translateZ(0);
          will-change: transform;
        }
        .maplibregl-canvas {
          outline: none;
        }
        .maplibregl-ctrl-group {
          background: #1b1b23 !important;
          border: 1px solid rgba(255,255,255,0.05) !important;
          border-radius: 12px !important;
          overflow: hidden;
        }
        .maplibregl-ctrl-group button {
          border-color: rgba(255,255,255,0.05) !important;
        }
        .maplibregl-ctrl-group button span {
          filter: invert(1) brightness(2) sepia(1) saturate(5) hue-rotate(340deg);
        }
      `}} />
    </div>
  );
}

