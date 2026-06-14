import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import type { Database } from '../../integrations/supabase/types';
import CollageViewer, { type CollageCard } from './CollageViewer';
import CollageBuilder from './CollageBuilder';
import CustomScrapbookLayout from './CustomScrapbookLayout';
import type { CollageLayoutConfig } from './CollageBuilder';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface MemoryItem extends MessageRow {
  decryptedUrl?: string;
}
// Global/Module-level cache to persist decrypted images across tab switches/component unmounts
interface CollageCache {
  userId: string;
  partnerId: string;
  images: MemoryItem[];
  timestamp: number;
}
let globalCollageCache: CollageCache | null = null;

export default function RomanticCollages() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { getDecryptedBlob } = useMedia();

  // Initialize state from global cache if valid
  const [decryptedImages, setDecryptedImages] = useState<MemoryItem[]>(() => {
    if (
      globalCollageCache &&
      user &&
      partner &&
      globalCollageCache.userId === user.id &&
      globalCollageCache.partnerId === partner.id &&
      Date.now() - globalCollageCache.timestamp < 24 * 60 * 60 * 1000
    ) {
      return globalCollageCache.images;
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (
      globalCollageCache &&
      user &&
      partner &&
      globalCollageCache.userId === user.id &&
      globalCollageCache.partnerId === partner.id &&
      Date.now() - globalCollageCache.timestamp < 24 * 60 * 60 * 1000
    ) {
      return false;
    }
    return true;
  });

  const [viewerCardIndex, setViewerCardIndex] = useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [customLayouts, setCustomLayouts] = useState<Array<{ id: string; config: CollageLayoutConfig }>>([]);
  const generatedUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      // Do not revoke global cache URLs here, only local non-cached ones if any
      generatedUrlsRef.current.forEach(url => {
        const isCached = globalCollageCache?.images.some(img => img.decryptedUrl === url);
        if (!isCached) {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
        }
      });
      generatedUrlsRef.current.clear();
    };
  }, []);

  // Fetch saved custom collage layouts from Supabase
  useEffect(() => {
    if (!user || !partner) return;
    const fetchLayouts = async () => {
      const { data } = await supabase
        .from('custom_collage_layouts')
        .select('id, grid_size, frames')
        .eq('user_id', user.id)
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: true })
        .limit(5);
      if (data) {
        setCustomLayouts(data.map(row => ({
          id: row.id,
          config: { gridSize: row.grid_size, frames: row.frames as CollageLayoutConfig['frames'] }
        })));
      }
    };
    fetchLayouts();
  }, [user, partner]);

  // Save a new custom layout to Supabase
  const handleSaveLayout = async (config: CollageLayoutConfig) => {
    if (!user || !partner) return;
    if (customLayouts.length >= 5) return;
    const { data, error } = await supabase
      .from('custom_collage_layouts')
      .insert({ user_id: user.id, partner_id: partner.id, grid_size: config.gridSize, frames: config.frames })
      .select('id')
      .single();
    if (!error && data) {
      setCustomLayouts(prev => [...prev, { id: data.id, config }]);
    }
    setBuilderOpen(false);
  };

  useEffect(() => {
    if (!user || !partner?.public_key) return;

    // Check if global cache is valid, skip fetching/decrypting
    if (
      globalCollageCache &&
      globalCollageCache.userId === user.id &&
      globalCollageCache.partnerId === partner.id &&
      Date.now() - globalCollageCache.timestamp < 24 * 60 * 60 * 1000
    ) {
      setLoading(false);
      return;
    }

    let active = true;
    const fetchRandomMedia = async () => {
      setLoading(true);
      try {
        const CACHE_KEY = 'aura_collage_selection';
        const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 Hours

        let selectedIds: string[] = [];
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < CACHE_DURATION && parsed.ids && parsed.ids.length >= 3) {
              selectedIds = parsed.ids;
            }
          } catch (e) {
            console.error('Failed to parse cached collage selection:', e);
          }
        }

        if (selectedIds.length === 0) {
          // 1. Fetch user's favorited message IDs
          const { data: profileData } = await supabase
            .from('profiles')
            .select('favorited_message_ids')
            .eq('id', user.id)
            .single();
          const favs = profileData?.favorited_message_ids || [];

          // 2. Fetch some folder item IDs
          const { data: folderItems } = await supabase
            .from('media_folder_items')
            .select('message_id')
            .limit(40);
          const folderMsgIds = (folderItems || []).map(f => f.message_id);

          // 3. Fetch general image message IDs from chat
          const { data: generalMsg } = await supabase
            .from('messages')
            .select('id, media_url')
            .eq('type', 'image')
            .not('media_url', 'is', null)
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
            .limit(120);

          const cleanGeneralMsgIds = (generalMsg || [])
            .filter(m => m.media_url && !m.media_url.toLowerCase().includes('.gif'))
            .map(m => m.id);

          // Merge and shuffle to select up to 13 unique IDs (5 for collage 1, 4 each for collages 2 and 3)
          const allIds = Array.from(new Set([...favs, ...folderMsgIds, ...cleanGeneralMsgIds]));
          selectedIds = allIds.sort(() => 0.5 - Math.random()).slice(0, 13);

          if (selectedIds.length > 0) {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              ids: selectedIds,
              timestamp: Date.now()
            }));
          }
        }

        if (selectedIds.length === 0) {
          if (active) setLoading(false);
          return;
        }

        // Fetch full message details for the selected IDs
        const { data: messagesData } = await supabase
          .from('messages')
          .select('id,sender_id,media_url,media_key,media_nonce,type,created_at,sender_public_key')
          .in('id', selectedIds);

        if (!active) return;
        const msgItems = (messagesData || []) as MemoryItem[];

        const decryptPromises = msgItems.map(async (item) => {
          if (!item.media_url || !item.media_key || !item.media_nonce || !partner?.public_key) return null;
          if (item.media_url.toLowerCase().includes('.gif') || (item.type as string) === 'gif') return null;

          try {
            const historyKeys = partner.key_history?.map(k => k.public_key) || undefined;
            const blob = await getDecryptedBlob(
              item.media_url,
              item.media_key,
              item.media_nonce,
              partner.public_key,
              item.sender_public_key,
              historyKeys,
              'image'
            );
            if (blob) {
              const url = URL.createObjectURL(blob);
              generatedUrlsRef.current.add(url);
              return { ...item, decryptedUrl: url };
            }
          } catch (e) {
            console.error('Failed to decrypt collage image:', e);
          }
          return null;
        });

        const decryptedResults = await Promise.all(decryptPromises);
        const validDecrypted = decryptedResults.filter(Boolean) as MemoryItem[];

        if (active) {
          setDecryptedImages(validDecrypted);

          // Revoke old cache URLs before saving the new ones
          if (globalCollageCache) {
            globalCollageCache.images.forEach(img => {
              if (img.decryptedUrl) {
                try {
                  URL.revokeObjectURL(img.decryptedUrl);
                } catch (e) {}
              }
            });
          }

          // Save to global cache
          globalCollageCache = {
            userId: user.id,
            partnerId: partner.id,
            images: validDecrypted,
            timestamp: Date.now()
          };
        }
      } catch (err) {
        console.error('Error loading random collage media:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchRandomMedia();
    return () => {
      active = false;
    };
  }, [user, partner?.public_key]);

  if (!loading && decryptedImages.length < 3) {
    return null;
  }

  const collage1Images = decryptedImages.slice(0, 5);
  const collage2Images = decryptedImages.slice(5, 9);
  const collage3Images = decryptedImages.slice(9, 13);

  // Images for custom cards — slots beyond the first 13 in the pool, cycling back if needed
  const customCards: CollageCard[] = customLayouts.map((layout, layoutIdx) => {
    const slotStart = 13 + layoutIdx * 5;
    const poolImages = decryptedImages.length > 0
      ? Array.from({ length: layout.config.frames.length }, (_, i) =>
          decryptedImages[(slotStart + i) % decryptedImages.length]
        ).filter(img => !!img?.decryptedUrl).map(img => ({ id: img.id, decryptedUrl: img.decryptedUrl! }))
      : [];
    return {
      id: layout.id,
      type: 'custom' as const,
      images: poolImages,
      layoutConfig: layout.config,
    };
  });

  // Build CollageCard[] for the viewer
  const cards: CollageCard[] = [
    {
      id: 'scrapbook',
      type: 'scrapbook' as const,
      images: collage1Images
        .filter(i => !!i.decryptedUrl)
        .map(i => ({ id: i.id, decryptedUrl: i.decryptedUrl! })),
    },
    {
      id: 'polaroid',
      type: 'polaroid' as const,
      images: collage2Images
        .filter(i => !!i.decryptedUrl)
        .map(i => ({ id: i.id, decryptedUrl: i.decryptedUrl! })),
    },
    {
      id: 'gallery',
      type: 'gallery' as const,
      images: collage3Images
        .filter(i => !!i.decryptedUrl)
        .map(i => ({ id: i.id, decryptedUrl: i.decryptedUrl! })),
    },
    ...customCards,
  ].filter(c => c.images.length > 0 || c.type === 'custom');

  return (
    <>
      <div className="w-full mb-10 select-none px-4 sm:px-0">
        <div className="mb-6">
          <h2 className="font-serif italic text-2xl text-[var(--gold)]">Love Scrapbook</h2>
          <p className="text-xs font-label uppercase tracking-widest text-white/40">Handcrafted vintage collages of our memories</p>
        </div>

        {/* Collages Slide Deck */}
        <div
          className="flex gap-6 overflow-x-auto pb-4 pt-1 no-scrollbar snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none' }}
        >

          {/* Collage 1: The Classic Lover's Scrapbook */}
          <motion.div
            onClick={() => setViewerCardIndex(0)}
            whileHover={{ y: -4, scale: 1.01 }}
            transition={{ type: 'spring', damping: 20 }}
            className="w-[300px] sm:w-[340px] aspect-[3/4] flex-shrink-0 snap-start relative rounded-[2.5rem] bg-[#f4f0e6] border border-[#e8dfc7] shadow-xl overflow-hidden p-0 group cursor-pointer hover:border-[#c9a96e]/40 transition-colors duration-300"
          >
            <div className="absolute inset-0 bg-[radial-gradient(#d3c69f_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />
            <div className="absolute top-4 right-6 text-[#9a8656] font-serif italic text-[10px] tracking-widest opacity-60 z-30">Scrapbook page. 01</div>

            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center z-30">
                <div className="w-8 h-8 border-2 border-[#9a8656]/20 border-t-[#9a8656] rounded-full animate-spin" />
              </div>
            ) : (
              <div 
                className="w-full h-full border border-[#9a8656]/20 rounded-[1.5rem] relative overflow-hidden"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(50, 1fr)',
                  gridTemplateRows: 'repeat(50, 1fr)',
                }}
              >
                {/* 1. Top Left Square */}
                {collage1Images[0] && (
                  <div 
                    style={{
                      gridColumn: '3 / 27',
                      gridRow: '5 / 26',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
                      border: '1px solid rgba(0,0,0,0.05)',
                      borderRadius: '0.15rem',
                      padding: '0.2rem pb-3',
                    }}
                    className="z-10 overflow-hidden flex flex-col"
                  >
                    <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.05rem]">
                      <img src={collage1Images[0].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
                    </div>
                  </div>
                )}

                {/* 2. Top Right Rectangle */}
                {collage1Images[1] && (
                  <div 
                    style={{
                      gridColumn: '23 / 50',
                      gridRow: '7 / 19',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
                      border: '1px solid rgba(0,0,0,0.05)',
                      borderRadius: '0.15rem',
                      padding: '0.2rem pb-3',
                    }}
                    className="z-10 overflow-hidden flex flex-col"
                  >
                    <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.05rem]">
                      <img src={collage1Images[1].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
                    </div>
                  </div>
                )}

                {/* 3. Middle Right Rectangle */}
                {collage1Images[2] && (
                  <div 
                    style={{
                      gridColumn: '28 / 48',
                      gridRow: '16 / 45',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
                      border: '1px solid rgba(0,0,0,0.05)',
                      borderRadius: '0.15rem',
                      padding: '0.2rem pb-3',
                    }}
                    className="z-10 overflow-hidden flex flex-col"
                  >
                    <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.05rem]">
                      <img src={collage1Images[2].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
                    </div>
                  </div>
                )}

                {/* 4. Left Middle Square */}
                {collage1Images[3] && (
                  <div 
                    style={{
                      gridColumn: '5 / 25',
                      gridRow: '23 / 38',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
                      border: '1px solid rgba(0,0,0,0.05)',
                      borderRadius: '0.15rem',
                      padding: '0.2rem pb-3',
                    }}
                    className="z-10 overflow-hidden flex flex-col"
                  >
                    <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.05rem]">
                      <img src={collage1Images[3].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
                    </div>
                  </div>
                )}

                {/* 5. Bottom Connecting Rectangle */}
                {collage1Images[4] && (
                  <div 
                    style={{
                      gridColumn: '9 / 42',
                      gridRow: '34 / 47',
                      backgroundColor: '#ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
                      border: '1px solid rgba(0,0,0,0.05)',
                      borderRadius: '0.15rem',
                      padding: '0.2rem pb-3',
                    }}
                    className="z-10 overflow-hidden flex flex-col"
                  >
                    <div className="w-full h-full overflow-hidden bg-black/5 rounded-[0.05rem]">
                      <img src={collage1Images[4].decryptedUrl} className="w-full h-full object-cover brightness-[98%] contrast-[102%]" alt="" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="absolute bottom-4 left-6 right-6 z-30 pt-2 border-t border-[#e3dac1]/60 flex items-center justify-between pointer-events-none">
              <span className="font-serif italic text-xs text-[#9a8656] opacity-70">Our memories ♥</span>
              <div className="flex items-center gap-1 text-[#9a8656]/60">
                <span className="material-symbols-outlined text-base">open_in_full</span>
              </div>
            </div>
          </motion.div>

          {/* Collage 2: Staggered Retro Polaroids */}
          <motion.div
            onClick={() => setViewerCardIndex(1)}
            whileHover={{ y: -4, scale: 1.01 }}
            transition={{ type: 'spring', damping: 20 }}
            className="w-[300px] sm:w-[340px] aspect-[3/4] flex-shrink-0 snap-start relative rounded-[2.5rem] bg-[#1a1a24] border border-white/5 shadow-xl overflow-hidden p-0 group cursor-pointer hover:border-[var(--gold)]/30 transition-colors duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0b0f] to-[#252538] opacity-50 pointer-events-none" />
            <div className="absolute top-4 right-6 text-white/20 font-label uppercase text-[7px] tracking-widest z-30">Polaroid series. 02</div>

            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center z-30">
                <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--gold)] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="relative w-full h-full">
                {collage2Images[0] && (
                  <div className="absolute left-[4%] top-[10%] w-[42%] bg-[#fefefe] p-1.5 pb-5 shadow-lg border border-black/10 rotate-[-15deg] z-10">
                    <div className="w-full aspect-square overflow-hidden bg-black/5">
                      <img src={collage2Images[0].decryptedUrl} className="w-full h-full object-cover brightness-[95%] contrast-[105%]" alt="" />
                    </div>
                  </div>
                )}
                {collage2Images[1] && (
                  <div className="absolute right-[4%] top-[8%] w-[42%] bg-[#fefefe] p-1.5 pb-5 shadow-lg border border-black/10 rotate-[18deg] z-10">
                    <div className="w-full aspect-square overflow-hidden bg-black/5">
                      <img src={collage2Images[1].decryptedUrl} className="w-full h-full object-cover brightness-[95%] contrast-[105%]" alt="" />
                    </div>
                  </div>
                )}
                {collage2Images[2] && (
                  <div className="absolute left-[18%] top-[22%] w-[46%] bg-[#fefefe] p-1.5 pb-5 shadow-xl border border-black/10 rotate-[-6deg] z-20 group-hover:scale-105 transition-transform duration-500">
                    <div className="w-full aspect-square overflow-hidden bg-black/5">
                      <img src={collage2Images[2].decryptedUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                  </div>
                )}
                {collage2Images[3] && (
                  <div className="absolute right-[16%] bottom-[10%] w-[44%] bg-[#fefefe] p-1.5 pb-5 shadow-xl border border-black/10 rotate-[8deg] z-25">
                    <div className="w-full aspect-square overflow-hidden bg-black/5">
                      <img src={collage2Images[3].decryptedUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="absolute bottom-4 left-6 right-6 z-30 pt-2 border-t border-white/5 flex items-center justify-between pointer-events-none">
              <span className="font-serif italic text-xs text-[var(--gold)] opacity-70">Retro polaroids ✦</span>
              <div className="flex items-center gap-1 text-[var(--gold)]/50">
                <span className="material-symbols-outlined text-base">open_in_full</span>
              </div>
            </div>
          </motion.div>

          {/* Collage 3: Victorian Ornate Gallery Wall */}
          <motion.div
            onClick={() => setViewerCardIndex(2)}
            whileHover={{ y: -4, scale: 1.01 }}
            transition={{ type: 'spring', damping: 20 }}
            className="w-[300px] sm:w-[340px] aspect-[3/4] flex-shrink-0 snap-start relative rounded-[2.5rem] bg-[#1d1414] border border-[#2f1f1f] shadow-xl overflow-hidden p-0 group cursor-pointer hover:border-[#c9a96e]/40 transition-colors duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[#2a1717] via-transparent to-[#100707] opacity-60 pointer-events-none" />
            <div className="absolute top-4 right-6 text-[#c9a96e]/30 font-label uppercase text-[7px] tracking-widest z-30">Gallery Room. 03</div>

            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center z-30">
                <div className="w-8 h-8 border-2 border-[#c9a96e]/20 border-t-[var(--gold)] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="relative w-full h-full">
                {collage3Images[0] && (
                  <div className="absolute left-[3%] top-[4%] w-[38%] aspect-[3/4] rounded-[60px] overflow-hidden p-1 bg-gradient-to-br from-[#d4af37] via-[#aa7c11] to-[#f3e5ab] shadow-lg border border-black/20 z-10">
                    <div className="w-full h-full rounded-[55px] overflow-hidden">
                      <img src={collage3Images[0].decryptedUrl} className="w-full h-full object-cover brightness-[90%]" alt="" />
                    </div>
                  </div>
                )}
                {collage3Images[1] && (
                  <div className="absolute right-[3%] top-[4%] w-[42%] aspect-square p-1.5 bg-gradient-to-tr from-[#d4af37] via-[#aa7c11] to-[#f3e5ab] shadow-lg border border-black/20 z-10">
                    <div className="w-full h-full overflow-hidden border-2 border-[#543b09]">
                      <img src={collage3Images[1].decryptedUrl} className="w-full h-full object-cover brightness-[90%]" alt="" />
                    </div>
                  </div>
                )}
                {collage3Images[2] && (
                  <div className="absolute left-[20%] bottom-[14%] w-[45%] aspect-square p-2 bg-gradient-to-r from-[#e5c158] via-[#aa7c11] to-[#d4af37] shadow-xl border border-black/20 z-25 group-hover:scale-105 transition-transform duration-500">
                    <div className="w-full h-full overflow-hidden border-2 border-[#543b09]">
                      <img src={collage3Images[2].decryptedUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                  </div>
                )}
                {collage3Images[3] && (
                  <div className="absolute right-[6%] bottom-[6%] w-[34%] aspect-square rounded-full p-1 bg-gradient-to-br from-[#f3e5ab] via-[#aa7c11] to-[#d4af37] shadow-lg border border-black/20 z-25">
                    <div className="w-full h-full rounded-full overflow-hidden border border-[#543b09]">
                      <img src={collage3Images[3].decryptedUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="absolute bottom-4 left-6 right-6 z-30 pt-2 border-t border-[#372323] flex items-center justify-between pointer-events-none">
              <span className="font-serif italic text-xs text-[#c9a96e] opacity-70">Victorian gallery ✦</span>
              <div className="flex items-center gap-1 text-[#c9a96e]/50">
                <span className="material-symbols-outlined text-base">open_in_full</span>
              </div>
            </div>
          </motion.div>
          {/* Custom cards */}
          {customCards.map((card, idx) => (
            <motion.div
              key={card.id}
              onClick={() => setViewerCardIndex(3 + idx)}
              whileHover={{ y: -4, scale: 1.01 }}
              transition={{ type: 'spring', damping: 20 }}
              className="w-[300px] sm:w-[340px] aspect-[3/4] flex-shrink-0 snap-start relative rounded-[2.5rem] bg-[#f4f0e6] border border-[#e8dfc7] shadow-xl overflow-hidden p-0 group cursor-pointer hover:border-[#c9a96e]/40 transition-colors duration-300"
            >
              <div className="absolute inset-0 bg-[radial-gradient(#d3c69f_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />
              <div className="absolute top-4 right-6 text-[#9a8656] font-serif italic text-[10px] tracking-widest opacity-60 z-30">Custom. {String(idx + 1).padStart(2, '0')}</div>

              {card.layoutConfig && (
                <div className="absolute inset-0">
                  <CustomScrapbookLayout
                    config={card.layoutConfig}
                    images={card.images}
                    onImageClick={() => setViewerCardIndex(3 + idx)}
                  />
                </div>
              )}

              <div className="absolute bottom-4 left-6 right-6 z-30 pt-2 border-t border-[#e3dac1]/60 flex items-center justify-between pointer-events-none">
                <span className="font-serif italic text-xs text-[#9a8656] opacity-70">Custom layout ✦</span>
                <div className="flex items-center gap-1 text-[#9a8656]/60">
                  <span className="material-symbols-outlined text-base">open_in_full</span>
                </div>
              </div>
            </motion.div>
          ))}

          {/* + Add New Card button */}
          {customLayouts.length < 5 && (
            <motion.button
              onClick={() => setBuilderOpen(true)}
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', damping: 20 }}
              className="w-[300px] sm:w-[340px] aspect-[3/4] flex-shrink-0 snap-start relative rounded-[2.5rem] border-2 border-dashed border-[var(--gold)]/30 flex flex-col items-center justify-center gap-4 group hover:border-[var(--gold)]/60 transition-colors duration-300 bg-white/3 cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/30 flex items-center justify-center group-hover:bg-[var(--gold)]/20 group-hover:border-[var(--gold)]/50 transition-all duration-300">
                <span className="material-symbols-outlined text-3xl text-[var(--gold)]/70 group-hover:text-[var(--gold)] transition-colors">add</span>
              </div>
              <div className="text-center">
                <p className="font-serif italic text-[var(--gold)]/70 group-hover:text-[var(--gold)] transition-colors text-sm">Create your own</p>
                <p className="text-white/30 text-xs mt-0.5">Design a custom collage</p>
              </div>
            </motion.button>
          )}

        </div>
      </div>

      {/* Full-screen Collage Viewer (portal-based, like MomentViewer) */}
      <AnimatePresence>
        {viewerCardIndex !== null && cards.length > 0 && (
          <CollageViewer
            cards={cards}
            initialCardIndex={Math.min(viewerCardIndex, cards.length - 1)}
            onClose={() => setViewerCardIndex(null)}
          />
        )}
      </AnimatePresence>

      {/* Collage Builder portal */}
      <AnimatePresence>
        {builderOpen && (
          <CollageBuilder
            onSave={handleSaveLayout}
            onClose={() => setBuilderOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
