import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

export default function MemoriesScreen() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [selectedMedia, setSelectedMedia] = useState<{ url: string, type: string } | null>(null);

  useEffect(() => {
    fetchMemories();
  }, [user?.id, partner?.id]);

  const fetchMemories = async () => {
    if (!user || !partner) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .not('media_url', 'is', null)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMemories(data as MemoryItem[]);
    } catch (err) {
      console.error('Error fetching memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const decryptMedia = async (memory: MemoryItem) => {
    if (memory.decryptedUrl || !partner?.public_key || !memory.media_url || !memory.media_key || !memory.media_nonce) return;
    
    setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, loading: true } : m));
    
    try {
      const blob = await getDecryptedBlob(
        memory.media_url,
        memory.media_key,
        memory.media_nonce,
        partner.public_key
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, decryptedUrl: url, loading: false } : m));
      }
    } catch (err) {
      console.error('Decryption failed for memory:', memory.id, err);
      setMemories(prev => prev.map(m => m.id === memory.id ? { ...m, loading: false } : m));
    }
  };

  const filteredMemories = memories.filter(m => {
    if (filter === 'all') return true;
    return m.type === filter;
  });

  return (
    <div className="w-full h-full bg-[#0d0d15] flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="px-8 py-10 flex flex-col gap-6 border-b border-white/5 bg-black/20">
        <div>
          <h1 className="font-serif italic text-4xl text-[#e6c487] mb-2">Sanctuary Gallery</h1>
          <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#998f81]">A visual archive of our shared journey</p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
          {['all', 'image', 'video', 'audio'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-6 py-2 rounded-full text-[10px] font-label uppercase tracking-widest border transition-all whitespace-nowrap ${
                filter === f 
                  ? 'bg-[#e6c487] text-[#412d00] border-[#e6c487] font-bold shadow-lg shadow-[#e6c487]/10' 
                  : 'bg-transparent text-[#998f81] border-white/10 hover:border-white/20'
              }`}
            >
              {f === 'all' ? 'All Fragments' : f + 's'}
            </button>
          ))}
        </div>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-[#e6c487]/20 border-t-[#e6c487] rounded-full animate-spin"></div>
            <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[#e6c487]/40">Gathering Echoes...</p>
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-[#e6c487]">auto_awesome</span>
            <p className="font-serif italic text-xl text-[#e6c487]">The gallery is a blank canvas.</p>
            <p className="text-xs tracking-widest uppercase mt-2">Shared media will bloom here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[200px]">
            {filteredMemories.map((memory, index) => (
              <MemoryCard 
                key={memory.id} 
                memory={memory} 
                index={index}
                onDecrypt={() => decryptMedia(memory)}
                onClick={() => memory.decryptedUrl && setSelectedMedia({ url: memory.decryptedUrl, type: memory.type || 'image' })}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedMedia && (
          <MediaViewer 
            url={selectedMedia.url} 
            type={selectedMedia.type as any} 
            onClose={() => setSelectedMedia(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MemoryCard({ memory, index, onDecrypt, onClick }: { memory: MemoryItem, index: number, onDecrypt: () => void, onClick: () => void }) {
  useEffect(() => {
    onDecrypt();
  }, []);

  const isTall = index % 5 === 0;
  const isWide = index % 7 === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`relative group rounded-[2rem] overflow-hidden bg-black/40 border border-white/5 cursor-pointer shadow-xl ${
        isTall ? 'row-span-2' : isWide ? 'col-span-2' : ''
      }`}
    >
      {memory.loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#e6c487]/20 border-t-[#e6c487] rounded-full animate-spin"></div>
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
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1b1b23] gap-3">
              <span className="material-symbols-outlined text-4xl text-[#e6c487]">mic</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-[#e6c487]/60">Voice Fragment</span>
            </div>
          )}
          
          {/* Hover Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-6">
            <span className="text-[10px] text-white/60 mb-1 uppercase tracking-widest font-bold">
              {new Date(memory.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <p className="text-white text-xs font-serif italic line-clamp-2">
              {memory.decrypted_content || 'A silent fragment'}
            </p>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
          <span className="material-symbols-outlined text-3xl mb-2">lock</span>
          <span className="font-label text-[8px] uppercase tracking-widest">Encrypted</span>
        </div>
      )}
    </motion.div>
  );
}
