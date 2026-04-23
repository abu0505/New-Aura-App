import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import type { Database } from '../../integrations/supabase/types';
import MediaViewer from '../chat/MediaViewer';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface MemoryItem extends MessageRow {
  decryptedUrl?: string;
  decrypted_content?: string;
  loading?: boolean;
}

interface SearchOverlayProps {
  onClose: () => void;
}

export default function SearchOverlay({ onClose }: SearchOverlayProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const [selectedDate, setSelectedDate] = useState('');
  const [results, setResults] = useState<MemoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);

  const handleSearch = async (date: string) => {
    if (!date || !user || !partner) return;
    setSelectedDate(date);
    setSearching(true);
    setResults([]);

    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('messages')
        .select('id,sender_id,receiver_id,media_url,media_key,media_nonce,type,created_at,sender_public_key,encrypted_content,nonce')
        .not('media_url', 'is', null)
        // Fix 5.1: Correct conversation-scoped filter (same fix as MemoriesScreen)
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      setResults((data || []) as MemoryItem[]);
    } catch (err) {
      
    } finally {
      setSearching(false);
    }
  };

  const decryptMedia = async (memory: MemoryItem) => {
    if (memory.decryptedUrl || !partner?.public_key || !memory.media_url || !memory.media_key || !memory.media_nonce) return;

    setResults(prev => prev.map(m => m.id === memory.id ? { ...m, loading: true } : m));

    try {
      const blob = await getDecryptedBlob(memory.media_url, memory.media_key, memory.media_nonce, partner.public_key);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setResults(prev => prev.map(m => m.id === memory.id ? { ...m, decryptedUrl: url, loading: false } : m));
      }
    } catch (err) {
      
      setResults(prev => prev.map(m => m.id === memory.id ? { ...m, loading: false } : m));
    }
  };

  // Eager decryption replaced with lazy-loading inside the result cards

  // Cleanup blobs
  useEffect(() => {
    return () => {
      results.forEach(r => { if (r.decryptedUrl) URL.revokeObjectURL(r.decryptedUrl); });
    };
  }, []);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-[var(--bg-primary)] flex flex-col"
    >
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-white/5 bg-black/20 shrink-0">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] transition-all">
            <span className="material-symbols-outlined text-[20px] block">arrow_back</span>
          </button>
          <div>
            <h2 className="font-serif italic text-xl text-[var(--gold)]">Search Memories</h2>
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">Find fragments by date</p>
          </div>
        </div>

        {/* Date Input */}
        <div className="relative">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleSearch(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/80 text-sm focus:outline-none focus:border-[rgba(var(--primary-rgb),_0.4)] transition-colors [color-scheme:dark]"
          />
        </div>

        {selectedDate && (
          <p className="mt-3 font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">
            {formatDate(selectedDate)} • {results.length} fragment{results.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {!selectedDate ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[var(--gold)]">calendar_month</span>
            <p className="font-serif italic text-xl text-[var(--gold)]">Pick a date</p>
            <p className="text-xs tracking-widest uppercase mt-2">to uncover hidden fragments</p>
          </div>
        ) : searching ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[rgba(var(--primary-rgb),_0.4)]">Searching...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[var(--gold)]">search_off</span>
            <p className="font-serif italic text-xl text-[var(--gold)]">No fragments found</p>
            <p className="text-xs tracking-widest uppercase mt-2">Nothing was shared on this day</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 auto-rows-[200px]">
            {results.map((memory) => (
              <motion.div
                key={memory.id}
                viewport={{ once: true, margin: "300px" }}
                onViewportEnter={() => {
                  if (!memory.decryptedUrl && !memory.loading) decryptMedia(memory);
                }}
                onClick={() => memory.decryptedUrl && setSelectedMedia({ url: memory.decryptedUrl, type: memory.type || 'image' })}
                className="relative group rounded-2xl overflow-hidden bg-black/40 border border-white/5 cursor-pointer"
              >
                {memory.loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-[rgba(var(--primary-rgb),_0.2)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                  </div>
                ) : memory.decryptedUrl ? (
                  <>
                    {memory.type === 'image' && (
                      <img src={memory.decryptedUrl} className="w-full h-full object-cover" alt="Memory" loading="lazy" />
                    )}
                    {memory.type === 'video' && (
                      <div className="w-full h-full relative">
                        <video src={memory.decryptedUrl} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <span className="material-symbols-outlined text-white text-3xl">play_circle</span>
                        </div>
                      </div>
                    )}
                    {memory.type === 'audio' && (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
                        <span className="material-symbols-outlined text-4xl text-[var(--gold)]">mic</span>
                        <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Voice</span>
                      </div>
                    )}
                    {memory.type === 'document' && (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-elevated)] gap-3">
                        <span className="material-symbols-outlined text-4xl text-[var(--gold)]">description</span>
                        <span className="font-label text-[8px] uppercase tracking-widest text-[rgba(var(--primary-rgb),_0.6)]">Document</span>
                      </div>
                    )}

                    {/* Date badge */}
                    <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg">
                      <span className="text-[9px] text-white/70">
                        {new Date(memory.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
                    <span className="material-symbols-outlined text-3xl mb-2">lock</span>
                    <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Media Viewer */}
      {selectedMedia && (
        <MediaViewer
          url={selectedMedia.url}
          type={selectedMedia.type as any}
          onClose={() => setSelectedMedia(null)}
        />
      )}
    </motion.div>
  );
}
