import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ChunkedVideoPlayer from './ChunkedVideoPlayer';
import { useVideoChunks } from '../../hooks/useVideoChunks';
import { supabase } from '../../lib/supabase';
import { usePartner } from '../../hooks/usePartner';
import { toast } from 'sonner';
import { useMediaFolders } from '../../hooks/useMediaFolders';

interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video' | 'gif' | 'chunked_video';
}

interface MediaViewerProps {
  url: string;
  type: 'image' | 'video' | 'chunked_video' | 'gif';
  onClose: () => void;
  allMedia?: MediaItem[];
  initialIndex?: number;
  chunks?: any[];
  thumbnailUrl?: string;
  duration?: number;
  messageId?: string;
  showViewInChat?: boolean;
}

function ChunkedVideoFetcher({ messageId, thumbnailUrl, duration }: { messageId: string, thumbnailUrl?: string, duration?: number }) {
  const { chunks, getChunksForMessage, loadExistingChunks } = useVideoChunks(messageId);
  const { partner } = usePartner();

  // Fetch chunks from DB and load them if they're not already in the store.
  // This is needed for videos opened from Memories/Videos tab (not from chat),
  // where ChatBubble never called loadExistingChunks.
  useEffect(() => {
    const existingChunks = getChunksForMessage(messageId);
    if (existingChunks && existingChunks.some(c => c.isDecrypted && c.blobUrl)) {
      console.log('[ChunkedVideoFetcher] msg=' + messageId + ' already has decrypted chunks, skipping DB fetch');
      return;
    }

    const partnerPublicKey = partner?.public_key;
    if (!partnerPublicKey) {
      console.warn('[ChunkedVideoFetcher] partner public key not available yet for msg=' + messageId);
      return;
    }

    let cancelled = false;

    const fetchAndLoad = async () => {
      console.log('[ChunkedVideoFetcher] fetching video_chunks from DB for msg=' + messageId);
      const { data, error } = await supabase
        .from('video_chunks')
        .select('chunk_index, total_chunks, chunk_url, chunk_key, chunk_nonce, duration')
        .eq('message_id', messageId)
        .order('chunk_index', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('[ChunkedVideoFetcher] DB error fetching chunks for msg=' + messageId, error);
        return;
      }

      if (data && data.length > 0) {
        console.log('[ChunkedVideoFetcher] Found', data.length, 'chunks in DB for msg=' + messageId + ', loading...');
        loadExistingChunks(messageId, data, partnerPublicKey);
      } else {
        console.log('[ChunkedVideoFetcher] No chunks found in DB for msg=' + messageId);
      }
    };

    fetchAndLoad();

    return () => { cancelled = true; };
  }, [messageId, partner?.public_key]);

  return (
    <ChunkedVideoPlayer 
      chunks={chunks} 
      thumbnailUrl={thumbnailUrl} 
      duration={duration}
      autoPlay
      className="w-full h-full max-h-full object-contain rounded-lg shadow-[0_25px_60px_rgba(0,0,0,0.8)]" 
    />
  );
}

export default function MediaViewer({ url: initialUrl, type: initialType, onClose, allMedia, initialIndex = 0, chunks, thumbnailUrl, duration, messageId, showViewInChat = false }: MediaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  
  const { folders, createFolder, addItemsToFolder } = useMediaFolders();
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const extractFrameAndSend = () => {
    const video = videoRef.current || document.querySelector('video');
    if (!video) {
      toast.error("Video not found");
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || video.clientWidth;
      canvas.height = video.videoHeight || video.clientHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Could not capture frame");
          return;
        }
        const file = new File([blob], 'extracted_frame.jpg', { type: 'image/jpeg' });
        document.dispatchEvent(new CustomEvent('send-extracted-frame', { detail: { file, caption: 'Extracted frame' } }));
        toast.success("Frame extracted and sent!");
      }, 'image/jpeg', 0.9);
    } catch(err) {
      console.error("Frame extraction error", err);
      toast.error("Failed to extract frame");
    }
  };

  const handleAddToFolder = async (folderId: string) => {
    if (!currentMedia.id) {
      toast.error("Cannot add this item to a folder");
      return;
    }
    const success = await addItemsToFolder(folderId, [currentMedia.id]);
    if (success) {
      toast.success("Added to folder");
      setShowFolderPicker(false);
    } else {
      toast.error("Failed to add to folder");
    }
  };

  const handleCreateFolderAndAdd = async () => {
    if (!newFolderName.trim() || !currentMedia.id) return;
    setIsCreatingFolder(true);
    const folderId = await createFolder(newFolderName.trim());
    if (folderId) {
      await addItemsToFolder(folderId, [currentMedia.id]);
      toast.success("Folder created and item added");
      setNewFolderName('');
      setShowFolderPicker(false);
    } else {
      toast.error("Failed to create folder");
    }
    setIsCreatingFolder(false);
  };

  // ── Inline video player state ─────────────────────────────────────────────
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoBuffered, setVideoBuffered] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryCountRef = useRef(0);

  // ── Inline image state ────────────────────────────────────────────────────
  const [imgLoading, setImgLoading] = useState(true);
  const [imgError, setImgError] = useState(false);
  const imgRetryRef = useRef(0);
  
  const currentMedia = allMedia ? allMedia[currentIndex] : { id: messageId, url: initialUrl, type: initialType };

  // Log initial props on mount
  useEffect(() => {
    console.log('[MediaViewer] mounted with props:', {
      initialUrl,
      initialType,
      hasAllMedia: !!allMedia,
      allMediaCount: allMedia?.length || 0,
      initialIndex,
      hasChunks: !!chunks,
      chunksCount: chunks?.length || 0,
      thumbnailUrl,
      duration,
      messageId,
      showViewInChat
    });
    return () => {
      console.log('[MediaViewer] unmounted');
    };
  }, []);

  // Reset ALL media states whenever the current item changes
  useEffect(() => {
    console.log('[MediaViewer] currentMedia changed:', {
      currentIndex,
      id: currentMedia.id,
      url: currentMedia.url,
      type: currentMedia.type
    });
    setVideoLoading(true);
    setVideoError(null);
    setVideoBuffered(0);
    retryCountRef.current = 0;
    setImgLoading(true);
    setImgError(false);
    imgRetryRef.current = 0;
  }, [currentMedia.url]);

  const handleVideoProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    const bufferedEnd = v.buffered.end(v.buffered.length - 1);
    const total = v.duration || 1;
    const pct = Math.round((bufferedEnd / total) * 100);
    console.log('[MediaViewer] video progress bufferedEnd:', bufferedEnd, 'total:', total, 'percent:', pct);
    setVideoBuffered(pct);
  }, []);

  const handleVideoCanPlay = useCallback(() => {
    console.log('[MediaViewer] video canplay event fired! Loading finished successfully.');
    setVideoLoading(false);
    setVideoError(null);
  }, []);

  const handleVideoError = useCallback(() => {
    const v = videoRef.current;
    const errCode = v?.error?.code;
    const errMsg = v?.error?.message;
    console.error('[MediaViewer] video error event fired!', {
      errCode,
      errMsg,
      src: v?.src,
      networkState: v?.networkState,
      readyState: v?.readyState,
      retryCount: retryCountRef.current
    });

    // Try once more silently before showing the error UI
    if (retryCountRef.current < 1 && v) {
      retryCountRef.current += 1;
      const src = v.src;
      console.log('[MediaViewer] Attempting silent video retry. Resetting src to:', src);
      v.src = '';
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.src = src;
          videoRef.current.load();
        }
      }, 400);
      return;
    }
    setVideoLoading(false);
    setVideoError('Could not play this video. The format may not be supported by your browser.');
  }, []);

  const retryVideo = useCallback(() => {
    console.log('[MediaViewer] manual video retry triggered');
    if (!videoRef.current) return;
    retryCountRef.current = 0;
    setVideoError(null);
    setVideoLoading(true);
    videoRef.current.load();
  }, []);

  // Lock body scroll while viewer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { 
      console.log('[MediaViewer] restoring body scroll style:', prev);
      document.body.style.overflow = prev; 
    };
  }, []);

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (allMedia && currentIndex < allMedia.length - 1) {
      setDirection(1);
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (allMedia && currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const distance = touchStartX - touchEndX;

    if (distance > 50) {
      handleNext();
    } else if (distance < -50) {
      handlePrev();
    }
    setTouchStartX(null);
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    })
  };

  const content = (
    <AnimatePresence mode="wait">
      <motion.div
        key="media-viewer-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        {/* Top left info */}
        <div className="absolute top-4 left-4 md:top-6 md:left-6 z-[10000]">
          {allMedia && allMedia.length > 1 && (
            <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-full text-primary font-bold text-xs uppercase tracking-widest border border-white/5">
              {currentIndex + 1} / {allMedia.length}
            </div>
          )}
        </div>

        <div className="absolute top-4 right-4 md:top-6 md:right-6 flex gap-1.5 md:gap-3 z-[10000]">
          {showViewInChat && currentMedia.id && (
            <button
              title="View in Chat"
              onClick={(e) => {
                e.stopPropagation();
                const jumpId = currentMedia.id;
                if (jumpId) {
                  document.dispatchEvent(new CustomEvent('switch-tab', { detail: 'chat' }));
                  setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('jump-to-message', { detail: { messageId: jumpId } }));
                  }, 100);
                  onClose();
                }
              }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-2xl">forum</span>
            </button>
          )}
          
          {(currentMedia.type === 'video' || currentMedia.type === 'chunked_video') && (
            <button
              title="Extract & Send Frame"
              onClick={(e) => {
                e.stopPropagation();
                extractFrameAndSend();
              }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-2xl">camera</span>
            </button>
          )}

          {currentMedia.id && (
            <div className="relative">
              <button
                title="Add to Folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFolderPicker(!showFolderPicker);
                }}
                className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-2xl">create_new_folder</span>
              </button>
              
              <AnimatePresence>
                {showFolderPicker && (
                  <>
                    {/* Backdrop click-away listener for the dropdown */}
                    <div 
                      className="fixed inset-0 z-[10000]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFolderPicker(false);
                      }}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      onClick={(e) => e.stopPropagation()}
                      className="fixed md:absolute top-20 md:top-full left-0 right-0 mx-auto md:left-auto md:right-0 md:mx-0 mt-0 md:mt-2 w-64 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl flex flex-col gap-2 z-[10001]"
                    >
                      <div className="text-xs text-white/50 font-bold uppercase tracking-widest mb-1 px-1">Add to Folder</div>
                      
                      <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                        {folders.map(folder => (
                          <button
                            key={folder.id}
                            onClick={() => handleAddToFolder(folder.id)}
                            className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                          >
                            <span className="material-symbols-outlined text-sm text-[var(--gold)]">folder</span>
                            <span className="text-sm text-white/90 truncate">{folder.name}</span>
                          </button>
                        ))}
                        {folders.length === 0 && (
                          <div className="text-xs text-white/40 px-2 py-1 italic">No folders yet</div>
                        )}
                      </div>
                      
                      <div className="h-px bg-white/10 my-1" />
                      
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="New folder name..."
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolderAndAdd(); }}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[var(--gold)] transition-colors"
                        />
                        <button
                          onClick={handleCreateFolderAndAdd}
                          disabled={isCreatingFolder || !newFolderName.trim()}
                          className="bg-[var(--gold)] text-black rounded-lg px-3 py-1.5 text-sm font-bold disabled:opacity-50 transition-opacity"
                        >
                          Add
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}

          {(currentMedia.type === 'image' || currentMedia.type === 'gif') && (
            <button
              title="Copy Image"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const response = await fetch(currentMedia.url);
                  let blob = await response.blob();

                  if (blob.type !== 'image/png') {
                    const image = new Image();
                    image.crossOrigin = 'anonymous';
                    const objectUrl = URL.createObjectURL(blob);
                    
                    await new Promise((resolve, reject) => {
                      image.onload = resolve;
                      image.onerror = reject;
                      image.src = objectUrl;
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(image, 0, 0);

                    blob = await new Promise<Blob>((resolve, reject) => {
                      canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error('Canvas to Blob failed'));
                      }, 'image/png');
                    });
                    
                    URL.revokeObjectURL(objectUrl);
                  }

                  await navigator.clipboard.write([
                    new ClipboardItem({
                      [blob.type]: blob
                    })
                  ]);
                  toast.success("Image copied to clipboard");
                } catch (err) {
                  console.error('Failed to copy image', err);
                  toast.error("Failed to copy image");
                }
              }}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-2xl">content_copy</span>
            </button>
          )}
          <a
            href={currentMedia.url}
            download
            onClick={(e) => e.stopPropagation()}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-2xl">download</span>
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-[#e4e1ed] backdrop-blur-md transition-colors cursor-pointer flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-2xl font-bold">close</span>
          </button>
        </div>

        {/* Navigation Arrows */}
        {allMedia && allMedia.length > 1 && (
          <div className="hidden md:block">
            {currentIndex > 0 && (
              <button 
                onClick={handlePrev}
                className="absolute left-4 z-[10001] p-4 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-sm top-1/2 -translate-y-1/2"
              >
                <span className="material-symbols-outlined text-3xl">chevron_left</span>
              </button>
            )}
            {currentIndex < allMedia.length - 1 && (
              <button 
                onClick={handleNext}
                className="absolute right-4 z-[10001] p-4 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all backdrop-blur-sm top-1/2 -translate-y-1/2"
              >
                <span className="material-symbols-outlined text-3xl">chevron_right</span>
              </button>
            )}
          </div>
        )}

        {/* Viewer Content — key on ID not URL to avoid jitter when URL populates */}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={currentMedia.id ?? currentMedia.url}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
          {currentMedia.type === 'image' || currentMedia.type === 'gif' ? (
            // ── Smart image with loading + error states ────────────────────
            <div
              className="relative flex items-center justify-center w-full h-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Show loading spinner while URL is empty or image is loading */}
              <AnimatePresence>
                {(imgLoading || !currentMedia.url) && !imgError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.7)', minWidth: 220, minHeight: 140 }}
                  >
                    <div
                      className="w-10 h-10 rounded-full border-[3px] animate-spin"
                      style={{ borderColor: 'var(--gold, #e4b45a)', borderTopColor: 'transparent' }}
                    />
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--gold-light, #f5d48a)' }}>
                      Decrypting image…
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error state */}
              <AnimatePresence>
                {imgError && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg p-6 text-center"
                    style={{ background: 'rgba(0,0,0,0.9)', minWidth: 220, minHeight: 140 }}
                  >
                    <span className="material-symbols-outlined text-red-400 text-4xl">broken_image</span>
                    <p className="text-white/70 text-sm font-medium">Image could not be loaded.</p>
                    <button
                      onClick={() => { imgRetryRef.current = 0; setImgError(false); setImgLoading(true); }}
                      className="mt-1 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
                      style={{ background: 'var(--gold, #e4b45a)', color: '#000' }}
                    >
                      Retry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actual image — only render when URL is ready */}
              {currentMedia.url && (
                <TransformWrapper
                  initialScale={1}
                  minScale={0.5}
                  maxScale={6}
                  centerOnInit
                  centerZoomedOut
                >
                  <TransformComponent
                    wrapperStyle={{ width: '100vw', height: '100vh' }}
                    contentStyle={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <img
                      src={currentMedia.url}
                      alt=""
                      onLoad={() => {
                        console.log('[MediaViewer] image loaded successfully. Src:', currentMedia.url);
                        setImgLoading(false);
                        setImgError(false);
                      }}
                      onError={() => {
                        console.error('[MediaViewer] image load error! Src:', currentMedia.url, 'retryAttempt:', imgRetryRef.current);
                        if (imgRetryRef.current < 1) {
                          imgRetryRef.current++;
                          // Force reload by appending a dummy param
                          setImgLoading(true);
                          setImgError(false);
                        } else {
                          setImgLoading(false);
                          setImgError(true);
                        }
                      }}
                      style={{
                        maxWidth: '100vw',
                        maxHeight: '100vh',
                        width: 'auto',
                        height: 'auto',
                        objectFit: 'contain',
                        userSelect: 'none',
                        borderRadius: '.5rem',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
                        opacity: imgLoading ? 0 : 1,
                        transition: 'opacity 0.3s ease',
                      }}
                      draggable={false}
                    />
                  </TransformComponent>
                </TransformWrapper>
              )}
            </div>
          ) : currentMedia.type === 'chunked_video' ? (
            <div className="w-full h-full flex items-center justify-center p-1">
              {chunks ? (
                <ChunkedVideoPlayer 
                  chunks={chunks} 
                  thumbnailUrl={thumbnailUrl || currentMedia.url} 
                  duration={duration}
                  autoPlay
                  className="w-full h-full max-h-full object-contain rounded-lg shadow-[0_25px_60px_rgba(0,0,0,0.8)]" 
                />
              ) : currentMedia.id ? (
                <ChunkedVideoFetcher
                  messageId={currentMedia.id}
                  thumbnailUrl={thumbnailUrl || currentMedia.url}
                  duration={duration}
                />
              ) : (
                <div className="text-white/50 text-sm">Cannot load video</div>
              )}
            </div>
          ) : (
            /* ── Smart video player with loading + error states ── */
            <div
              className="relative flex items-center justify-center"
              style={{ maxWidth: '99%', maxHeight: '99%' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Actual video element */}
              <video
                ref={videoRef}
                src={currentMedia.url}
                controls
                autoPlay
                playsInline
                preload="auto"
                onCanPlay={handleVideoCanPlay}
                onProgress={handleVideoProgress}
                onError={handleVideoError}
                style={{
                  maxWidth: '99vw',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  borderRadius: '.5rem',
                  background: 'black',
                  boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
                  // Keep element in DOM even during loading so it buffers
                  opacity: videoError ? 0 : 1,
                  display: 'block',
                }}
              />

              {/* Loading overlay — shown while buffering, disappears once canplay fires */}
              <AnimatePresence>
                {videoLoading && !videoError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.85)', minWidth: 220, minHeight: 140 }}
                  >
                    {/* Spinner */}
                    <div
                      className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin"
                      style={{ borderColor: 'var(--gold, #e4b45a)', borderTopColor: 'transparent' }}
                    />
                    {/* Buffer progress bar */}
                    {videoBuffered > 0 && (
                      <div className="w-36 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: 'var(--gold, #e4b45a)' }}
                          animate={{ width: `${videoBuffered}%` }}
                          transition={{ ease: 'linear', duration: 0.3 }}
                        />
                      </div>
                    )}
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--gold-light, #f5d48a)' }}>
                      {videoBuffered > 0 ? `Buffering ${videoBuffered}%…` : 'Loading video…'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error overlay */}
              <AnimatePresence>
                {videoError && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg p-6 text-center"
                    style={{ background: 'rgba(0,0,0,0.92)', minWidth: 220, minHeight: 140 }}
                  >
                    <span className="material-symbols-outlined text-red-400 text-4xl">videocam_off</span>
                    <p className="text-white/80 text-sm font-medium leading-snug max-w-[240px]">
                      Video could not be played.
                    </p>
                    <p className="text-white/40 text-xs max-w-[240px]">
                      {videoError}
                    </p>
                    <button
                      onClick={retryVideo}
                      className="mt-1 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all active:scale-95"
                      style={{ background: 'var(--gold, #e4b45a)', color: '#000' }}
                    >
                      Retry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

