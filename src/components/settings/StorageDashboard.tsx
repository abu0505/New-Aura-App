import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useMedia } from '../../hooks/useMedia';

interface StorageStats {
  image: { count: number; size: number };
  video: { count: number; size: number };
  audio: { count: number; size: number };
  document: { count: number; size: number };
  totalSize: number;
}

export default function StorageDashboard() {
  const { user } = useAuth();
  const { getCacheSize } = useMedia();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const cacheSize = getCacheSize();

  useEffect(() => {
    async function fetchStorageData() {
      if (!user) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('type, file_size')
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .not('type', 'is', null);

        if (error) throw error;

        const defaultStats = {
          image: { count: 0, size: 0 },
          video: { count: 0, size: 0 },
          audio: { count: 0, size: 0 },
          document: { count: 0, size: 0 },
          totalSize: 0,
        };

        const aggregated = (data || []).reduce((acc, row) => {
          const type = (row.type as keyof Omit<StorageStats, 'totalSize'>) || 'document';
          const size = row.file_size || 0;
          if (acc[type]) {
            acc[type].count += 1;
            acc[type].size += size;
            acc.totalSize += size;
          }
          return acc;
        }, defaultStats);

        setStats(aggregated);
      } catch (err) {
        
      } finally {
        setLoading(false);
      }
    }

    fetchStorageData();
  }, [user]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const colors = {
    image: 'var(--gold)', // gold
    video: '#D4A0A0', // rose
    audio: '#6ECB8A', // green
    document: '#8A8799', // muted
    cache: '#4A4857', // dark muted
  };

  const totalUsed = (stats?.totalSize || 0) + cacheSize;
  const segments = useMemo(() => {
    if (!stats || totalUsed === 0) return [];
    return [
      { type: 'image', size: stats.image.size, color: colors.image, label: 'Photos' },
      { type: 'video', size: stats.video.size, color: colors.video, label: 'Videos' },
      { type: 'audio', size: stats.audio.size, color: colors.audio, label: 'Voice' },
      { type: 'document', size: stats.document.size, color: colors.document, label: 'Files' },
      { type: 'cache', size: cacheSize, color: colors.cache, label: 'Local Cache' }
    ].filter(s => s.size > 0).sort((a, b) => b.size - a.size);
  }, [stats, cacheSize, totalUsed]);

  if (loading) {
    return (
      <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 border border-white/5 animate-pulse">
        <div className="h-6 w-32 bg-white/10 rounded-full mb-6"></div>
        <div className="h-4 w-full bg-white/10 rounded-full mb-4"></div>
        <div className="flex gap-4">
          <div className="h-3 w-16 bg-white/10 rounded-full"></div>
          <div className="h-3 w-16 bg-white/10 rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 border border-white/5 relative overflow-hidden">
      {/* Background glow based on primary color */}
      {segments.length > 0 && (
        <div 
          className="absolute -top-20 -right-20 w-40 h-40 blur-[80px] rounded-full opacity-20 pointer-events-none"
          style={{ backgroundColor: segments[0].color }}
        />
      )}

      <div className="mb-6 flex items-end justify-between">
        <div>
          <h3 className="font-serif italic text-xl text-[var(--gold)]">Storage</h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mt-1">
            Data secured in the sanctuary
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-light text-white">{formatBytes(totalUsed)}</p>
          <p className="font-label text-[9px] uppercase tracking-[0.2em] text-white/40">Total Used</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-4 bg-black/40 rounded-full overflow-hidden flex gap-[2px] relative z-10 shadow-inner mb-6">
        {totalUsed === 0 ? (
          <div className="w-full h-full bg-white/5"></div>
        ) : (
          segments.map((segment, idx) => (
            <motion.div
              key={segment.type}
              initial={{ width: 0 }}
              animate={{ width: `${(segment.size / totalUsed) * 100}%` }}
              transition={{ delay: idx * 0.1, duration: 0.8, type: 'spring', bounce: 0.2 }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ backgroundColor: segment.color }}
            />
          ))
        )}
      </div>

      {/* Legend Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-2 relative z-10">
        {segments.map(segment => (
          <div key={segment.type} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: segment.color }}></div>
            <div className="flex flex-col">
              <span className="font-label text-[9px] uppercase tracking-widest text-white/60">
                {segment.label}
              </span>
              <span className="text-xs text-white/40">{formatBytes(segment.size)}</span>
            </div>
          </div>
        ))}
        {segments.length === 0 && (
          <p className="col-span-full text-center text-[10px] text-white/20 uppercase tracking-widest py-4">
            Sanctuary is empty
          </p>
        )}
      </div>
    </div>
  );
}
