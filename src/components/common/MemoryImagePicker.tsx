import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { useMediaFolders, type MediaFolder } from '../../hooks/useMediaFolders';
import type { Database } from '../../integrations/supabase/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

interface MemoryItem extends MessageRow {
  decryptedUrl?: string;
  loading?: boolean;
}

interface MemoryImagePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (blob: Blob) => void;
}

// Sub-component to handle decryption of a folder's cover image
function FolderCover({ folderId, initialMessageId }: { folderId: string; initialMessageId: string | null }) {
  const { getDecryptedBlob } = useMedia();
  const { partner } = usePartner();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadCover = async () => {
      if (!partner?.public_key) return;
      try {
        let targetMsg: {
          id: string;
          media_url: string | null;
          media_key: string | null;
          media_nonce: string | null;
          type: string | null;
          thumbnail_url: string | null;
        } | null = null;

        if (initialMessageId) {
          const { data, error } = await supabase
            .from('messages')
            .select('id, media_url, media_key, media_nonce, type, thumbnail_url')
            .eq('id', initialMessageId)
            .single();

          if (!error && data) {
            targetMsg = data;
          }
        }

        if (!targetMsg) {
          const { data: folderItems, error: itemsError } = await supabase
            .from('media_folder_items')
            .select('message_id')
            .eq('folder_id', folderId);

          if (!itemsError && folderItems && folderItems.length > 0) {
            const msgIds = folderItems.map(item => item.message_id);
            const { data: imgMsgs } = await supabase
              .from('messages')
              .select('id, media_url, media_key, media_nonce, type, thumbnail_url')
              .in('id', msgIds)
              .eq('type', 'image')
              .order('created_at', { ascending: false })
              .limit(1);

            if (imgMsgs && imgMsgs.length > 0) {
              targetMsg = imgMsgs[0];
            }
          }
        }

        if (!targetMsg) {
          if (active) setLoading(false);
          return;
        }

        const decryptUrl = targetMsg.media_url;
        if (!decryptUrl || !targetMsg.media_key || !targetMsg.media_nonce) {
          throw new Error('Missing decryption parameters');
        }

        const blob = await getDecryptedBlob(
          decryptUrl,
          targetMsg.media_key,
          targetMsg.media_nonce,
          partner.public_key,
          undefined,
          undefined,
          'image'
        );

        if (blob && active) {
          setUrl(URL.createObjectURL(blob));
        }
      } catch (err) {
        // Silent error
      } finally {
        if (active) setLoading(false);
      }
    };

    loadCover();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [folderId, initialMessageId, partner?.public_key]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white/[0.02]">
        <div className="w-4 h-4 border border-white/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white/[0.02] text-white/20">
        <span className="material-symbols-outlined text-4xl">folder</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      className="w-full h-full object-cover object-center"
      alt="Folder Cover"
    />
  );
}

// Sub-component to decrypt and render a single photo card
function PickerImageCard({ item, onSelect }: { item: MemoryItem; onSelect: (blob: Blob) => void }) {
  const { getDecryptedBlob } = useMedia();
  const { partner } = usePartner();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [blobObj, setBlobObj] = useState<Blob | null>(null);

  useEffect(() => {
    let active = true;
    const decrypt = async () => {
      if (!partner?.public_key || !item.media_url || !item.media_key || !item.media_nonce) return;
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
        if (blob && active) {
          const objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          setBlobObj(blob);
        }
      } catch (err) {
        console.error("Failed to decrypt in picker:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    decrypt();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id, partner?.public_key]);

  return (
    <div
      onClick={() => !loading && url && blobObj && onSelect(blobObj)}
      className="relative aspect-square rounded-2xl overflow-hidden bg-black/30 border border-white/5 cursor-pointer hover:border-[var(--gold)]/50 hover:shadow-lg transition-all duration-300 group flex items-center justify-center"
    >
      {loading ? (
        <div className="w-5 h-5 border border-white/20 border-t-[var(--gold)] rounded-full animate-spin"></div>
      ) : url ? (
        <img src={url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Memory" />
      ) : (
        <span className="material-symbols-outlined text-white/25 text-3xl">lock</span>
      )}
    </div>
  );
}

export default function MemoryImagePicker({ isOpen, onClose, onSelect }: MemoryImagePickerProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { folders, loading: loadingFolders } = useMediaFolders();

  const [activeTab, setActiveTab] = useState<'all' | 'folders'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<MediaFolder | null>(null);
  
  // All Memories states
  const [allMemories, setAllMemories] = useState<MemoryItem[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  // Folder Items states
  const [folderItems, setFolderItems] = useState<MemoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Reset folder view and filters when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setSelectedFolder(null);
      setSearchQuery('');
      setDateFilter('');
      setActiveTab('all');
    }
  }, [isOpen]);

  // Load All Memories (Photos shared directly in chat)
  useEffect(() => {
    if (!isOpen || activeTab !== 'all' || !user || !partner) return;
    
    let active = true;
    const fetchAllMemories = async () => {
      setLoadingAll(true);
      try {
        let query = supabase
          .from('messages')
          .select('id,sender_id,receiver_id,media_url,media_key,media_nonce,type,created_at,sender_public_key')
          .eq('type', 'image')
          .not('media_url', 'is', null)
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`);

        if (dateFilter) {
          const startOfDay = new Date(dateFilter);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(dateFilter);
          endOfDay.setHours(23, 59, 59, 999);
          query = query.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
        }

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(80); // Fetch recent 80 images

        if (error) throw error;
        if (active) {
          setAllMemories((data || []) as MemoryItem[]);
        }
      } catch (err) {
        console.error('Error fetching all memory images:', err);
      } finally {
        if (active) setLoadingAll(false);
      }
    };

    fetchAllMemories();
    return () => {
      active = false;
    };
  }, [isOpen, activeTab, dateFilter, user, partner]);

  // Load items when a folder is opened
  useEffect(() => {
    if (!selectedFolder || !user || !partner) return;
    
    let active = true;
    const loadItems = async () => {
      setLoadingItems(true);
      setFolderItems([]);
      try {
        // 1. Fetch message IDs in folder
        const { data: itemData, error: itemError } = await supabase
          .from('media_folder_items')
          .select('message_id')
          .eq('folder_id', selectedFolder.id)
          .order('added_at', { ascending: false });

        if (itemError) throw itemError;
        if (!active) return;

        const messageIds = (itemData || []).map(d => d.message_id);
        if (messageIds.length === 0) {
          setFolderItems([]);
          setLoadingItems(false);
          return;
        }

        // 2. Fetch corresponding image messages
        const { data: msgData, error: msgError } = await supabase
          .from('messages')
          .select('id,sender_id,media_url,media_key,media_nonce,type,created_at,sender_public_key,thumbnail_url')
          .in('id', messageIds)
          .eq('type', 'image') // Only allow selecting images for profile and background
          .order('created_at', { ascending: false });

        if (msgError) throw msgError;
        if (active) {
          setFolderItems((msgData || []) as MemoryItem[]);
        }
      } catch (err) {
        console.error('Error loading folder items in picker:', err);
      } finally {
        if (active) setLoadingItems(false);
      }
    };

    loadItems();
    return () => {
      active = false;
    };
  }, [selectedFolder, user, partner]);

  // Filter folders by search query
  const filteredFolders = folders.filter(folder => {
    const name = folder.name || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-[var(--bg-secondary)] border border-white/10 rounded-[2.5rem] w-full max-w-2xl h-[75vh] flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/5 bg-black/20 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              {selectedFolder && (
                <button
                  onClick={() => setSelectedFolder(null)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#998f81] hover:text-[var(--gold)] transition-colors"
                >
                  <span className="material-symbols-outlined text-lg block">arrow_back</span>
                </button>
              )}
              <div>
                <h3 className="font-serif italic text-lg text-[var(--gold)]">
                  {selectedFolder ? selectedFolder.name : 'Select from Memories'}
                </h3>
                <p className="font-label text-[9px] uppercase tracking-widest text-[#998f81]">
                  {selectedFolder 
                    ? `${folderItems.length} photos available` 
                    : activeTab === 'all' 
                      ? `${allMemories.length} chat photos found`
                      : `${folders.length} collections available`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Tabs Navigation (only when not in a folder details view) */}
          {!selectedFolder && (
            <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5 mx-6 mt-4 shrink-0">
              <button
                onClick={() => {
                  setActiveTab('all');
                  setSearchQuery('');
                  setDateFilter('');
                }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest transition-all ${
                  activeTab === 'all'
                    ? 'bg-[var(--gold)] text-black font-bold shadow-lg shadow-[var(--gold)]/10'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                All Shared Photos
              </button>
              <button
                onClick={() => {
                  setActiveTab('folders');
                  setSearchQuery('');
                  setDateFilter('');
                }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-label uppercase tracking-widest transition-all ${
                  activeTab === 'folders'
                    ? 'bg-[var(--gold)] text-black font-bold shadow-lg shadow-[var(--gold)]/10'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                Folders / Collections
              </button>
            </div>
          )}

          {/* Filters Bar */}
          {!selectedFolder && (
            <div className="px-6 py-4 border-b border-white/5 bg-black/10 flex gap-3 shrink-0 items-center">
              {activeTab === 'folders' ? (
                // Folder Search
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-white/30 text-lg">search</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search folders (e.g. romantic memories)..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 py-2.5 text-white/80 placeholder:text-white/25 text-xs focus:outline-none focus:border-[var(--gold)]/40 transition-colors"
                  />
                </div>
              ) : (
                // All Memories Date Filter
                <div className="flex items-center gap-3 w-full">
                  <span className="text-white/40 font-label text-[10px] uppercase tracking-wider whitespace-nowrap">Filter by Date:</span>
                  <div className="relative flex-1">
                    <input
                      type="date"
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-white/85 text-xs focus:outline-none focus:border-[var(--gold)]/40 transition-colors [color-scheme:dark]"
                    />
                    {dateFilter && (
                      <button
                        onClick={() => setDateFilter('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      >
                        <span className="material-symbols-outlined text-sm block">clear</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {selectedFolder ? (
              // Inside Folder Details View
              loadingItems ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-[rgba(var(--primary-rgb),_0.1)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                  <p className="font-label text-[9px] uppercase tracking-widest text-white/40">Loading folder contents...</p>
                </div>
              ) : folderItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <span className="material-symbols-outlined text-4xl text-[var(--gold)] mb-2">image_not_supported</span>
                  <p className="font-serif italic text-base text-[var(--gold)]">No photos found</p>
                  <p className="text-[10px] tracking-widest uppercase mt-1">This folder contains no image items</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {folderItems.map(item => (
                    <PickerImageCard
                      key={item.id}
                      item={item}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              )
            ) : activeTab === 'all' ? (
              // All Memories Tab View
              loadingAll ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-[rgba(var(--primary-rgb),_0.1)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                  <p className="font-label text-[9px] uppercase tracking-widest text-white/40">Loading all photos...</p>
                </div>
              ) : allMemories.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <span className="material-symbols-outlined text-4xl text-[var(--gold)] mb-2">photo_library</span>
                  <p className="font-serif italic text-base text-[var(--gold)]">No shared photos</p>
                  <p className="text-[10px] tracking-widest uppercase mt-1">
                    {dateFilter ? 'No photos shared on this date' : 'No photos shared in this chat yet'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {allMemories.map(item => (
                    <PickerImageCard
                      key={item.id}
                      item={item}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              )
            ) : (
              // Folders List View
              loadingFolders ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-2 border-[rgba(var(--primary-rgb),_0.1)] border-t-[var(--gold)] rounded-full animate-spin"></div>
                  <p className="font-label text-[9px] uppercase tracking-widest text-[#998f81]">Loading collections...</p>
                </div>
              ) : filteredFolders.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <span className="material-symbols-outlined text-4xl text-[var(--gold)] mb-2">folder_open</span>
                  <p className="font-serif italic text-base text-[var(--gold)]">No matching collections</p>
                  <p className="text-[10px] tracking-widest uppercase mt-1">Try another search term</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {filteredFolders.map(folder => (
                    <div
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder)}
                      className="bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden cursor-pointer hover:bg-white/[0.04] hover:border-[var(--gold)]/20 hover:shadow-lg transition-all group flex flex-col h-44 relative"
                    >
                      {/* Cover Preview */}
                      <div className="flex-1 w-full relative overflow-hidden bg-white/[0.02]">
                        <FolderCover folderId={folder.id} initialMessageId={folder.cover_message_id} />
                      </div>
                      
                      {/* Footer Info */}
                      <div className="p-3 bg-black/45 border-t border-white/5 backdrop-blur-sm shrink-0">
                        <h4 className="text-xs text-white font-medium truncate">{folder.name || 'Encrypted Folder'}</h4>
                        <p className="font-label text-[8px] uppercase tracking-widest text-white/60 mt-0.5">
                          {folder.item_count || 0} photo{(folder.item_count || 0) !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
