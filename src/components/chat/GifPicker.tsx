import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface GifPickerProps {
  onSelect: (gif: { url: string; thumbnail: string; type: string }) => void;
  onClose: () => void;
}

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '5rVDl6amK40B5xIa5npdN3vPZoTHoSW5';

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = async (searchQuery: string = '') => {
    if (!GIPHY_API_KEY) {
      setError('GIPHY API Key missing. Please add VITE_GIPHY_API_KEY to .env');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const endpoint = searchQuery 
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchQuery)}&limit=20&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`;
      
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch GIFs from GIPHY');
      const data = await response.json();
      setGifs(data.data || []);
    } catch (err) {
      
      setError('Could not load GIFs. Check your connection or API key.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGifs();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchGifs(val);
    }, 500);
  };

  return (
    <div className="flex flex-col h-full bg-aura-bg-elevated/95 backdrop-blur-2xl border-t border-white/10 overflow-hidden">
      {/* Search Header */}
      <div className="p-4 flex items-center gap-3 border-b border-white/5">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-aura-text-secondary text-xl">search</span>
          <input 
            type="text"
            value={query}
            onChange={handleSearchChange}
            placeholder="Search GIPHY..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm text-aura-text-primary focus:outline-none focus:border-primary/50 transition-colors"
            autoFocus
          />
        </div>
        <button 
          onClick={onClose}
          className="text-aura-text-secondary hover:text-aura-text-primary transition-colors text-sm font-medium pr-1"
        >
          Cancel
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        {error && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <span className="material-symbols-outlined text-4xl text-red-400/50 mb-2">error</span>
            <p className="text-sm text-aura-text-secondary">{error}</p>
          </div>
        )}

        {loading && gifs.length === 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="aspect-square bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 pb-8">
            <AnimatePresence>
              {gifs.map((gif) => {
                // GIPHY specific mappings
                const mediaMP4 = gif.images?.original?.mp4 || gif.images?.fixed_height?.mp4;
                const mediaGif = gif.images?.fixed_height?.url || gif.images?.original?.url;
                const preview = gif.images?.fixed_height?.url;
                const thumbnail = gif.images?.fixed_height_small?.url || preview;
                
                return (
                  <motion.button
                    key={gif.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onSelect({ 
                      url: mediaMP4 || mediaGif, 
                      thumbnail: thumbnail,
                      type: mediaMP4 ? 'video' : 'image' 
                    })}
                    className="relative aspect-square rounded-xl overflow-hidden bg-white/5 group border border-white/5"
                  >
                    <img 
                      src={preview} 
                      alt={gif.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {gifs.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full text-aura-text-secondary">
            <span className="material-symbols-outlined text-4xl mb-2 opacity-20">search_off</span>
            <p className="text-sm">No GIFs found for "{query}"</p>
          </div>
        )}
      </div>

      {/* Footer Branding */}
      <div className="px-4 py-2 flex justify-end bg-black/20">
        <div className="flex items-center gap-1 opacity-60">
          <span className="text-[8px] uppercase tracking-tighter font-bold text-white/40">Powered by</span>
          <img 
            src="https://raw.githubusercontent.com/Giphy/giphy-js/master/packages/components/static/img/giphy-logo.svg" 
            alt="GIPHY" 
            className="h-3" 
          />
        </div>
      </div>
    </div>
  );
};
