import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { useMedia } from '../../hooks/useMedia';
import { getCacheStats, clearMediaCache } from '../../lib/mediaCache';
import StorageDashboard from './StorageDashboard';
import GarbageCanSection from './GarbageCanSection';

export default function StorageSection() {
  const { signOut } = useAuth();
  const { clearCache } = useMedia();
  const [cacheStats, setCacheStats] = useState({ totalBytes: 0, itemCount: 0 });

  const loadStats = async () => {
    const stats = await getCacheStats();
    setCacheStats(stats);
  };

  useEffect(() => {
    loadStats();
    // Refresh stats periodically when looking at settings
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClearCache = async () => {
    // Clear localStorage items related to media or temporary state
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('aura_cache_') || key.startsWith('aura_temp_')) {
        localStorage.removeItem(key);
      }
    });

    // Clear runtime Blob URL map (this frees actual RAM/Egress)
    clearCache();
    
    // Clear IndexedDB persistent cache
    await clearMediaCache();
    await loadStats();

    toast.success('Local cache cleared', {
      description: 'Persistent and memory caches have been reset.',
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return '< 1 MB';
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="md:col-span-2 space-y-8">
      {/* Visual Storage Dashboard */}
      <StorageDashboard />

      {/* Garbage Can */}
      <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 border border-white/5">
        <GarbageCanSection />
      </div>

      {/* Cache Management */}
      <div className="flex flex-col md:flex-row gap-4">
        <button 
          onClick={handleClearCache}
          className="flex-1 bg-white/5 border border-white/10 text-white/40 py-6 px-4 rounded-full font-label font-bold tracking-[0.4em] uppercase text-[10px] hover:bg-white/10 hover:text-white/60 transition-all duration-300 group flex flex-col items-center justify-center gap-2"
        >
          <div className="flex items-center justify-center gap-3">
            <span className="material-symbols-outlined text-sm group-hover:rotate-12 transition-transform">cleaning_services</span>
            Manage App Storage
          </div>
          <div className="text-[9px] text-white/30 tracking-widest normal-case">
            Media Cache: {formatBytes(cacheStats.totalBytes)} ({cacheStats.itemCount} items)
          </div>
        </button>

        {/* Global Sign Out */}
        <button 
          onClick={signOut}
          className="flex-1 bg-red-500/10 border border-red-500/20 text-red-400 py-6 rounded-full font-label font-bold tracking-[0.4em] uppercase text-[10px] hover:bg-red-500/20 hover:text-red-300 transition-all active:scale-[0.98] duration-300 shadow-2xl shadow-red-500/5 group"
        >
          <span className="flex items-center justify-center gap-3">
            <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">logout</span>
            Dissolve Connection
          </span>
        </button>
      </div>

      <footer className="text-center opacity-30 pt-10 pb-20">
        <h2 className="font-serif italic text-2xl text-[var(--gold)] mb-2 tracking-widest">AURA</h2>
        <p className="font-label text-[8px] uppercase tracking-[0.5em] text-white">App Data Protocol v2.25.9</p>
      </footer>
    </div>
  );
}
