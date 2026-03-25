import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLiveLocation } from '../../hooks/useLiveLocation';
import { useMemo, useEffect } from 'react';
import type { PartnerProfile } from '../../hooks/usePartner';

// Custom Marker Icons for Leaflet to match AURA's premium style
const createUserIcon = () => L.divIcon({
  html: `<div class="w-8 h-8 bg-white rounded-full border-2 border-[#13131b] flex items-center justify-center shadow-2xl">
           <span class="material-symbols-outlined text-[#13131b] text-sm">home</span>
         </div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const createPartnerIcon = (avatarUrl: string) => L.divIcon({
  html: `<div class="relative w-10 h-10">
           <div class="w-10 h-10 rounded-full border-2 border-[#e6c487] overflow-hidden shadow-2xl bg-[#1b1b23]">
             <img src="${avatarUrl}" class="w-full h-full object-cover" />
           </div>
           <div class="absolute -top-1 -right-1 w-4 h-4 bg-[#e6c487] rounded-full flex items-center justify-center shadow-lg">
             <span class="material-symbols-outlined text-[#412d00] text-[10px] font-bold">favorite</span>
           </div>
         </div>`,
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20]
});

// Helper component to handle map centering
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
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

  const toggleSharing = () => {
    if (isSharing) {
      stopSharing();
    } else {
      startSharing();
    }
  };

  const mapCenter = useMemo((): [number, number] => {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (partnerLocation) return [partnerLocation.lat, partnerLocation.lng];
    return [0, 0];
  }, [userLocation, partnerLocation]);

  const userIcon = useMemo(() => createUserIcon(), []);
  const partnerIcon = useMemo(() => 
    createPartnerIcon(partner?.avatar_url || 'https://ui-avatars.com/api/?name=Partner&background=c9a96e&color=13131b'),
    [partner?.avatar_url]
  );

  return (
    <div className="h-full w-full bg-[#0d0d15] relative overflow-hidden flex flex-col font-sans">
      {/* Header Overlay */}
      <header className="absolute top-0 left-0 w-full z-[1000] p-6 lg:p-12 pointer-events-none">
        <div className="flex justify-between items-start w-full gap-4">
          <div className="bg-[#1b1b23]/80 backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl pointer-events-auto flex-1 min-w-[200px] max-w-sm">
            <h1 className="font-serif italic text-3xl text-[#e6c487] mb-1">Our Sanctuary</h1>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#e6c487] animate-pulse"></span>
              <p className="text-white/60 text-xs uppercase tracking-widest font-bold">
                {distanceKm ? `${distanceKm} km apart` : 'Live Synchronicity'}
              </p>
            </div>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>

          <button 
            onClick={toggleSharing}
            className={`pointer-events-auto px-6 py-3 rounded-full font-label font-bold tracking-widest uppercase text-[10px] transition-all duration-500 shadow-2xl flex items-center gap-3 ${isSharing ? 'bg-[#e6c487] text-[#412d00]' : 'bg-[#1b1b23] text-white/40 border border-white/5'}`}
          >
            <span className={`w-2 h-2 rounded-full ${isSharing ? 'bg-[#412d00] animate-pulse' : 'bg-white/20'}`}></span>
            {isSharing ? 'SHARING LOCATION' : 'LOCATION PRIVATE'}
          </button>
        </div>
      </header>

      {/* Map Container */}
      <div className="flex-1 z-0">
        <MapContainer 
          center={mapCenter} 
          zoom={13} 
          zoomControl={false}
          style={{ height: '100%', width: '100%', background: '#0d0d15' }}
          className="aura-map"
        >
          <ChangeView center={mapCenter} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {userLocation && (
            <Marker 
              position={[userLocation.lat, userLocation.lng]} 
              icon={userIcon}
            >
              <Popup className="aura-popup">
                <div className="p-1">
                  <p className="font-bold text-[#e6c487]">You</p>
                  <p className="text-[10px] text-white/60 uppercase">Sharing live location</p>
                </div>
              </Popup>
            </Marker>
          )}

          {partnerLocation && (
            <Marker 
              position={[partnerLocation.lat, partnerLocation.lng]} 
              icon={partnerIcon}
            >
              <Popup className="aura-popup">
                <div className="p-1">
                  <p className="font-bold text-[#e6c487]">{partner?.display_name || 'Partner'}</p>
                  <p className="text-[10px] text-white/60 uppercase">In the sanctuary</p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Bottom Info Bar */}
      <footer className="absolute bottom-12 left-0 w-full z-[1000] px-6 lg:px-12 pointer-events-none">
        <div className="max-w-md mx-auto bg-[#1b1b23]/80 backdrop-blur-xl rounded-[2.5rem] border border-white/5 p-8 shadow-3xl pointer-events-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className={`w-14 h-14 rounded-full border-2 p-1 transition-colors duration-500 ${partnerLocation ? 'border-[#e6c487]' : 'border-white/10'}`}>
              <img 
                src={partner?.avatar_url || 'https://ui-avatars.com/api/?name=Partner&background=c9a96e&color=13131b'} 
                alt="Partner" 
                className={`w-full h-full object-cover rounded-full transition-all duration-500 ${!partnerLocation && 'grayscale opacity-50'}`} 
              />
            </div>
            <div>
              <p className={`font-serif italic text-lg leading-tight transition-colors duration-500 ${partnerLocation ? 'text-[#e6c487]' : 'text-white/40'}`}>
                {partner?.display_name || 'Partner'}
              </p>
              <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mt-1">
                {partnerLocation ? 'LIVE LOCATION ACTIVE' : 'LOCATION HIDDEN'}
              </p>
            </div>
          </div>
          
          <button 
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${partnerLocation ? 'bg-[#e6c487]/10 text-[#e6c487] hover:bg-[#e6c487]/20' : 'bg-white/5 text-white/20'}`}
            disabled={!partnerLocation}
          >
            <span className="material-symbols-outlined">navigation</span>
          </button>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        .leaflet-container {
          background: #0d0d15 !important;
        }
        .aura-popup .leaflet-popup-content-wrapper {
          background: #1b1b23 !important;
          color: #e4e1ed !important;
          border-radius: 1rem !important;
          border: 1px solid rgba(255,255,255,0.05) !important;
          padding: 0 !important;
        }
        .aura-popup .leaflet-popup-tip {
          background: #1b1b23 !important;
        }
        .leaflet-bar {
          border: none !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
        }
        .leaflet-bar a {
          background: #1b1b23 !important;
          color: #e6c487 !important;
          border-bottom: 1px solid rgba(255,255,255,0.05) !important;
        }
      `}} />
    </div>
  );
}
