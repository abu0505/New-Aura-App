import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, Fragment } from 'react';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import { useMediaFolders } from '../../hooks/useMediaFolders';
import AttachmentSheet from './AttachmentSheet';
import MediaGalleryDrawer from './MediaGalleryDrawer';
import AudioRecorder from './AudioRecorder';
import QualityChoiceModal from './QualityChoiceModal';
import { StickerPicker } from './StickerPicker';
import { GifPicker } from './GifPicker';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';
import MobileCameraModal from './MobileCameraModal';
import FolderPickerPopup from './FolderPickerPopup';
import type { SelectedMemoryMedia } from './FolderPickerPopup';

import type { ChatMessage } from '../../hooks/useChat';
import { useAuth } from '../../contexts/AuthContext';
import { EmojiText } from '../common/PremiumEmoji';
import { useAutocompletePhrases } from '../../hooks/useAutocompletePhrases';

export interface MessageInputHandle {
  handleDroppedFiles: (files: File[]) => void;
  focusInput: () => void;
}

interface MessageInputProps {
  onSend: (text: string, media?: { url: string, media_key: string, media_nonce: string, type: string }, replyToId?: string) => void;
  onTyping?: (isTyping: boolean) => void;
  disabled?: boolean;
  replyingTo?: ChatMessage | null;
  onCancelReply?: () => void;
  isActive?: boolean;
  partnerPublicKey?: string | null;
  onDesktopCameraClick?: () => void;
  onOptimisticMediaStart?: (text: string, localMediaUrl: string, type: string, replyToId?: string) => string;
  onOptimisticMediaComplete?: (tempId: string, text: string, media: { url: string, media_key: string, media_nonce: string, type: string }, replyToId?: string) => void;
  partnerId?: string;
  onChunkedVideoStart?: (thumbnailLocalUrl: string, replyToId?: string) => string;
  onChunkedVideoStatusUpdate?: (tempId: string, status: string) => void;
  onChunkedVideoCommit?: (tempId: string, thumbResult: { url: string; key: string; nonce: string } | null, duration: number, replyToId?: string) => Promise<void>;
  onChunkedVideoFinalize?: (tempId: string) => void;
}

const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(({ 
  onSend, onTyping, disabled, replyingTo, onCancelReply, isActive, partnerPublicKey, onDesktopCameraClick, onOptimisticMediaStart, onOptimisticMediaComplete, partnerId, onChunkedVideoStart, onChunkedVideoStatusUpdate, onChunkedVideoCommit, onChunkedVideoFinalize
}, ref) => {
  const { user } = useAuth();
  const { folders, loading: foldersLoading } = useMediaFolders(); // Prefetch here
  const [text, setText] = useState('');
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [isMobileCameraOpen, setIsMobileCameraOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [isGifPickerOpen, setIsGifPickerOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [lastSelectedEmoji, setLastSelectedEmoji] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingCaption, _setPendingCaption] = useState('');
  const [replyMediaUrl, setReplyMediaUrl] = useState<string | null>(null);
  
  const { phrases } = useAutocompletePhrases();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  const maxHeight = isMobile ? 72 : 120;

  // ── Folder picker (slash-command) state ──
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderSearch, setFolderSearch] = useState('');
  const [activeFolderChip, setActiveFolderChip] = useState<string | null>(null); // folder name shown as bold chip
  const [selectedFolderMedia, setSelectedFolderMedia] = useState<SelectedMemoryMedia[]>([]);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Clear selected media if chip is removed
  useEffect(() => {
    if (!activeFolderChip) {
      setSelectedFolderMedia([]);
    }
  }, [activeFolderChip]);

  // slashStartPos tracks the caret position where '/' was typed so we can replace that slice
  const slashStartPosRef = useRef<number>(-1);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastCursorPosRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyBlobUrlRef = useRef<string | null>(null);
  const { processAndUpload, getDecryptedBlob, processAndUploadChunked, generateVideoThumbnailFromFile } = useMedia();

  const getVideoDurationLocally = async (file: File): Promise<number> => {
    const { getVideoDuration } = await import('../../utils/videoChunker');
    return await getVideoDuration(file);
  };

  useImperativeHandle(ref, () => ({
    handleDroppedFiles: (files: File[]) => {
      if (files.length === 0) return;
      if (files.some(f => f.type.includes('image/') || f.type.includes('video/'))) {
        // setPendingFiles(files);
        // setPendingCaption('');
        // setShowQualityModal(true);
        performUpload(files, false, '');
      } else {
        performUpload(files, false, '');
      }
    },
    focusInput: () => {
      textareaRef.current?.focus();
    }
  }));

  // Auto-resize textarea.
  // Deferred to requestAnimationFrame so the browser can paint the typed character
  // *before* forcing a layout reflow to measure scrollHeight. This eliminates the
  // keystroke lag that becomes noticeable after many messages are in the DOM.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.style.height = 'auto';
      const scHeight = el.scrollHeight;
      
      // Fix: If content fits within max-height, disable overflow to prevent 
      // the "grabbing placeholder scroll" bug, especially on mobile.
      if (scHeight <= maxHeight) {
        el.style.overflowY = 'hidden';
      } else {
        el.style.overflowY = 'auto';
      }

      // Force 25px for single line if it's very small, otherwise use scrollHeight
      el.style.height = `${scHeight <= 32 ? 25 : Math.min(scHeight, maxHeight)}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [text, maxHeight]);

  // Handle auto-focus when tab becomes active
  useEffect(() => {
    if (isActive && textareaRef.current) {
      // Small delay to ensure any tab transition or layout shift is done
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  // Autocomplete suggestion effect
  useEffect(() => {
    if (!text || activeFolderChip) {
      setSuggestion(null);
      return;
    }
    
    const lowerText = text.toLowerCase();
    let bestSuggestion = null;
    let longestMatchLen = 0;

    for (const phrase of phrases) {
      const lowerPhrase = phrase.toLowerCase();
      
      for (let i = 0; i < lowerText.length; i++) {
        // Check if `i` is the start of a word (start of string or preceded by non-alphanumeric)
        const isWordBoundary = i === 0 || /\W/.test(lowerText[i - 1]);
        if (isWordBoundary) {
          const suffix = lowerText.slice(i);
          if (suffix.length > 0 && lowerPhrase.startsWith(suffix)) {
            if (lowerPhrase.length > suffix.length) {
              if (suffix.length > longestMatchLen) {
                longestMatchLen = suffix.length;
                bestSuggestion = phrase.slice(suffix.length);
              }
            }
          }
        }
      }
    }
    
    setSuggestion(bestSuggestion);
  }, [text, phrases, activeFolderChip]);

  const handleAutoComplete = () => {
    if (suggestion) {
      setText(text + suggestion);
      setSuggestion(null);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  // Auto-focus when replying to a message
  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      // Small delay helps with keyboard popping up reliably on mobile 
      // during the reply banner entrance animation
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [replyingTo]);
  
  // Decrypt media for reply preview
  useEffect(() => {
    if (replyingTo?.media_url && replyingTo?.media_key && replyingTo?.media_nonce && partnerPublicKey && !replyingTo?.is_deleted_for_everyone) {
      getDecryptedBlob(
        replyingTo.media_url, replyingTo.media_key, replyingTo.media_nonce, 
        partnerPublicKey,
        replyingTo.sender_public_key,
        undefined,
        replyingTo.type
      )
        .then(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            replyBlobUrlRef.current = url;
            setReplyMediaUrl(url);
          }
        });
    }
    return () => {
      if (replyBlobUrlRef.current) {
        URL.revokeObjectURL(replyBlobUrlRef.current);
        replyBlobUrlRef.current = null;
      }
      setReplyMediaUrl(null);
    };
  }, [
    replyingTo?.id,
    partnerPublicKey,
    replyingTo?.is_deleted_for_everyone,
    replyingTo?.media_url,
    replyingTo?.media_key,
    replyingTo?.media_nonce,
    replyingTo?.type,
    replyingTo?.sender_public_key,
    getDecryptedBlob
  ]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Store onTyping in a ref so the effect does not depend on the function reference.
  const onTypingRef = useRef(onTyping);
  useEffect(() => { onTypingRef.current = onTyping; }, [onTyping]);

  const clearTypingTimers = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
  };

  // Typing tracking — ONLY depends on [text], not on onTyping.
  // Sends typing:true immediately and then every 1s while typing continues.
  // Sends typing:false after 2s of no new keystrokes (timeout) or when text empties.
  useEffect(() => {
    const typingFn = onTypingRef.current;
    if (!typingFn) return;

    if (text) {
      // Send immediately on keystroke
      typingFn(true);

      // Clear old timers
      clearTypingTimers();

      // Re-send typing:true every 1s so the partner always gets a fresh signal
      // even if a previous broadcast was lost during a reconnect
      typingIntervalRef.current = setInterval(() => {
        onTypingRef.current?.(true);
      }, 1000);

      // Auto-stop after 2s of no new keystrokes
      typingTimeoutRef.current = setTimeout(() => {
        clearTypingTimers();
        onTypingRef.current?.(false);
      }, 2000);

      return () => {
        clearTypingTimers();
      };
    } else {
      clearTypingTimers();
      typingFn(false);
    }
  }, [text]);

  const handleSend = () => {
    const textToSend = text.trim();

    if ((textToSend || selectedFolderMedia.length > 0 || isUploading) && !disabled) {
      if (isUploading) return;
      clearTypingTimers();
      onTypingRef.current?.(false);
      
      const currentReplyId = replyingTo?.id;

      // Send selected media first, without the text
      selectedFolderMedia.forEach((item, idx) => {
        onSend(
          '', // No text attached to media bubbles
          { url: item.media_url, media_key: item.media_key, media_nonce: item.media_nonce, type: item.type },
          idx === 0 ? currentReplyId : undefined
        );
      });

      // Send the text message if any (after media)
      if (textToSend) {
        onSend(textToSend, undefined, selectedFolderMedia.length === 0 ? currentReplyId : undefined);
      }

      setText('');
      setActiveFolderChip(null);
      setSelectedFolderMedia([]);
      setShowFolderPicker(false);
      slashStartPosRef.current = -1;
      if (onCancelReply) onCancelReply();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      handleAutoComplete();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Smart Backspace for folder chip
    if (e.key === 'Backspace' && activeFolderChip) {
      const chipStr = `/${activeFolderChip}`;
      const chipIdx = text.indexOf(chipStr);
      if (chipIdx !== -1) {
        const chipEnd = chipIdx + chipStr.length;
        const caret = textareaRef.current?.selectionStart ?? 0;
        const caretEnd = textareaRef.current?.selectionEnd ?? 0;
        
        // If cursor is within the chip or immediately after its trailing space
        if (caret === caretEnd && caret > chipIdx && caret <= chipEnd + 1) {
          e.preventDefault();
          const before = text.slice(0, chipIdx);
          const after = text.slice(caret === chipEnd + 1 ? chipEnd + 1 : chipEnd).trimStart();
          setText(before + after);
          setActiveFolderChip(null);
          return;
        }
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.includes('image/') || items[i].type.includes('video/')) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      // Prevent pasting the file as text if it's already being handled as a media file
      e.preventDefault();
      // setPendingFiles(files);
      // setPendingCaption('');
      // setShowQualityModal(true);
      performUpload(files, false, '');
    }
  };

  const handleCameraClick = () => {
    if (window.innerWidth < 768) {
      setIsMobileCameraOpen(true);
    } else {
      if (onDesktopCameraClick) {
        onDesktopCameraClick();
      } else if (fileInputRef.current) {
        fileInputRef.current.accept = 'image/*,video/*';
        fileInputRef.current.capture = 'environment';
        fileInputRef.current.click();
      }
    }
  };

  const handleMobileCameraSend = (file: File, caption: string, duration?: number) => {
    // setPendingFiles([file]);
    // setPendingCaption(caption);
    // setShowQualityModal(true);
    performUpload([file], false, caption, duration);
  };

  const handleMobileGallerySelect = (files: File[], caption: string) => {
    handleGallerySend(files, caption);
  };

  const handleAttachmentSelect = (type: string) => {
    // Always close the sheet first to remove z-index blocking
    setIsAttachmentOpen(false);

    if (type === 'audio') {
      // Short delay to let sheet unmount before showing recorder
      setTimeout(() => setIsRecording(true), 150);
    } else if (type === 'sticker') {
      setIsStickerPickerOpen(true);
    } else if (type === 'gif') {
      setIsGifPickerOpen(true);
    } else if (type === 'photo' || type === 'video') {
      setIsMediaGalleryOpen(true);
    } else {
      // Delay file input click until sheet is fully unmounted (animation takes ~300ms)
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.accept = '*/*';
          fileInputRef.current.removeAttribute('capture');
          fileInputRef.current.click();
        }
      }, 350);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Check if any file requires quality selection (images or videos)
    if (files.some(f => f.type.includes('image/') || f.type.includes('video/'))) {
      // setPendingFiles(files);
      // setPendingCaption('');
      // setShowQualityModal(true);
      performUpload(files, false, '');
    } else {
      // Direct upload for all
      performUpload(files, false, '');
    }
  };

  const handleGallerySend = (files: File[], caption: string) => {
    if (files.some(f => f.type.includes('image/') || f.type.includes('video/'))) {
      // setPendingFiles(files);
      // setPendingCaption(caption);
      // setShowQualityModal(true);
      performUpload(files, false, caption);
    } else {
      performUpload(files, false, caption);
    }
  };

  const MAX_MEDIA_LIMIT = 10;

  const performUpload = async (files: File[], optimize: boolean, caption: string, durationOverride?: number) => {
    if (files.length > MAX_MEDIA_LIMIT) {
      toast(`Aree MERI BEGHAM JII aaram se! Ek sath sirf ${MAX_MEDIA_LIMIT} files bhej sakte ho. Pehli ${MAX_MEDIA_LIMIT} hi upload hongi. 😘💋`, {
        description: "Aura suggests smaller batches for absolute security.",
        duration: 9000,
      });
      files = files.slice(0, MAX_MEDIA_LIMIT);
    }

    const hasOptimistic = !!onOptimisticMediaStart && !!onOptimisticMediaComplete;
    
    if (!hasOptimistic) {
      setIsUploading(true);
    }
    setShowQualityModal(false);
    
    // Quick UI reset so user can continue texting
    setPendingFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const currentReplyId = replyingTo?.id;
    if (onCancelReply) onCancelReply();

    // If pessimistic
    if (!hasOptimistic) {
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const uploaded = await processAndUpload(file, { optimize });
          if (uploaded) {
            onSend('', {
              url: uploaded.url,
              media_key: uploaded.media_key,
              media_nonce: uploaded.media_nonce,
              type: uploaded.type
            }, i === 0 ? currentReplyId : undefined);
          }
        }
        if (caption.trim()) {
          onSend(caption.trim(), undefined, currentReplyId);
        }
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // Optimistic fast-path
    interface StandardUpload { file: File; tempId: string; }
    interface ChunkedUpload { file: File; tempId: string; thumbBlob: Blob | null; }

    const standardUploads: StandardUpload[] = [];
    const chunkedVideoUploads: ChunkedUpload[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = file.type.includes('video/') ? 'video' : (file.type.includes('audio/') ? 'audio' : 'image');
      // A "direct recording" is a file produced by MobileCameraModal or DesktopCameraStudio.
      // These use timestamp-based names: `video_<ms>.webm`, `video_<ms>.mp4`, `desktop_video_<ms>.webm`.
      // We check for the exact timestamp pattern to avoid matching gallery files that might
      // also start with "video_" (e.g., WhatsApp saves as video_2024-01-01.mp4).
      const directRecordingPattern = /^(desktop_video_|video_)\d+\.(webm|mp4)$/;
      const isDirectRecording = directRecordingPattern.test(file.name);
      
      if (type === 'video' && onChunkedVideoStart && !isDirectRecording) {
        // Generate a quick local thumbnail for the optimistic UI
        const thumbBlob = await generateVideoThumbnailFromFile(file);
        const thumbUrl = thumbBlob ? URL.createObjectURL(thumbBlob) : '';
        const tempId = onChunkedVideoStart(thumbUrl, i === 0 ? currentReplyId : undefined);
        chunkedVideoUploads.push({ file, tempId, thumbBlob });
      } else {
        const localUrl = URL.createObjectURL(file);
        const tempId = onOptimisticMediaStart!('', localUrl, type, i === 0 ? currentReplyId : undefined);
        standardUploads.push({ file, tempId });
      }
    }

    // Send caption as an independent message right after media placeholders
    if (caption.trim()) {
      // Use setTimeout to ensure the React state for media is queued first
      setTimeout(() => {
        onSend(caption.trim(), undefined, currentReplyId);
      }, 10);
    }

    // ─── Global Upload Semaphore ─────────────────────────────────────────────
    // A single shared pool of TOTAL_SLOTS concurrent network slots is used by
    // BOTH image uploads (high priority) and video chunk preparation (low priority).
    // Images grab slots first; video chunking fills whatever slots remain.
    // This mirrors how Telegram handles multi-media sends: maximum throughput
    // without congesting the network on slow mobile connections.
    //
    //  Slot budget:  6 total
    //    ├─ Images:  up to 4 slots (HIGH priority — finish first, user sees results fast)
    //    └─ Videos:  up to 2 slots (LOW priority  — run in background while images go)
    // ─────────────────────────────────────────────────────────────────────────

    const TOTAL_SLOTS = 6;
    const IMAGE_SLOTS = 4; // images get priority access to these many slots

    // Semaphore: tracks how many slots are currently occupied
    let usedSlots = 0;
    const waiters: Array<() => void> = []; // queue of tasks waiting for a free slot

    const acquireSlot = (): Promise<void> => new Promise(resolve => {
      if (usedSlots < TOTAL_SLOTS) {
        usedSlots++;
        resolve();
      } else {
        waiters.push(() => { usedSlots++; resolve(); });
      }
    });

    const releaseSlot = () => {
      usedSlots--;
      // Wake the next waiting task (if any)
      const next = waiters.shift();
      if (next) next();
    };

    // ── High-priority pipeline: image / audio uploads ─────────────────────
    const imagePipeline = async () => {
      const activeTasks = new Set<Promise<void>>();

      for (const { file, tempId } of standardUploads) {
        // Acquire a slot — images are allowed up to IMAGE_SLOTS concurrently
        // (semaphore naturally enforces the cap across both pipelines)
        await acquireSlot();

        const task = (async () => {
          try {
            const uploaded = await processAndUpload(file, { optimize });
            if (uploaded && tempId) {
              onOptimisticMediaComplete!(tempId, '', {
                url: uploaded.url,
                media_key: uploaded.media_key,
                media_nonce: uploaded.media_nonce,
                type: uploaded.type,
              }, currentReplyId);
            }
          } catch (err) {
            console.error('[Semaphore] Image upload failed for tempId:', tempId, err);
          } finally {
            releaseSlot();
          }
        })();

        activeTasks.add(task);
        task.finally(() => activeTasks.delete(task));

        // Local back-pressure: don't queue more than IMAGE_SLOTS at once
        if (activeTasks.size >= IMAGE_SLOTS) {
          await Promise.race(activeTasks);
        }
      }

      await Promise.all(activeTasks);
    };

    // ── Low-priority pipeline: video thumbnail upload + chunking ──────────
    const videoPipeline = async () => {
      for (const { file, tempId, thumbBlob } of chunkedVideoUploads) {
        try {
          // Step 1: Upload thumbnail (needs 1 network slot)
          let thumbDetails = null;
          if (thumbBlob) {
            await acquireSlot();
            try {
              const uploadedThumb = await processAndUpload(
                new File([thumbBlob], 'thumb.jpg', { type: 'image/jpeg' }),
                { optimize: false }
              );
              if (uploadedThumb) {
                thumbDetails = {
                  url: uploadedThumb.url,
                  key: uploadedThumb.media_key,
                  nonce: uploadedThumb.media_nonce,
                };
              }
            } finally {
              releaseSlot();
            }
          }

          // Step 2: Commit message row to DB (no network slot needed — DB write is fast)
          if (onChunkedVideoCommit) {
            const rawDuration = durationOverride !== undefined
              ? durationOverride
              : await getVideoDurationLocally(file);
            await onChunkedVideoCommit(tempId, thumbDetails, Math.round(rawDuration), currentReplyId);
          }

          // Step 3: Chunk + encrypt + upload (processAndUploadChunked manages its
          // own internal PARALLEL_LIMIT=5 for chunk network requests, so we don't
          // need to acquire semaphore slots here — it self-throttles)
          if (user?.id && partnerId) {
            await processAndUploadChunked(
              file,
              tempId,
              user.id,
              partnerId,
              (status) => onChunkedVideoStatusUpdate?.(tempId, status),
              durationOverride
            );
          }
        } catch (e) {
          console.error('[Semaphore] Video pipeline failed for tempId:', tempId, e);
        } finally {
          if (onChunkedVideoFinalize) onChunkedVideoFinalize(tempId);
        }
      }
    };

    // ── Fire both pipelines concurrently (images get head start via slot priority)
    await Promise.all([
      standardUploads.length > 0 ? imagePipeline() : Promise.resolve(),
      chunkedVideoUploads.length > 0 ? videoPipeline() : Promise.resolve(),
    ]);
  };

  const handleAudioComplete = (media: any) => {
    onSend('', media, replyingTo?.id);
    if (onCancelReply) onCancelReply();
    setIsRecording(false);
  };

  const handleEmojiSelect = (emoji: string) => {
    setLastSelectedEmoji(emoji);
    
    // Use functional update to ensure we don't lose emojis during fast spamming
    setText(prev => {
      const start = lastCursorPosRef.current;
      // If for some reason start is greater than text length, clamp it
      const safeStart = Math.min(start, prev.length);
      
      const before = prev.substring(0, safeStart);
      const after = prev.substring(safeStart);
      
      // Update the ref so the NEXT emoji (during spam) goes right after this one
      lastCursorPosRef.current = safeStart + emoji.length;
      
      return before + emoji + after;
    });
    
    // Focus stays on the picker for spamming
  };

  if (isRecording) {
    return (
      <div className="px-6 py-4 bg-background/80 backdrop-blur-3xl border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <AudioRecorder 
            onRecordingComplete={handleAudioComplete}
            onCancel={() => setIsRecording(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <footer className="shrink-0 w-full relative z-40 pt-2 pb-4 md:pb-6 px-2 md:px-8 flex flex-col items-center justify-end">
      {/* Emoji Picker positioned directly above input */}
      <AnimatePresence>
        {isEmojiPickerOpen && (
          <Fragment>
            {/* Click-outside backdrop (covers full screen reliably) */}
            <div 
              className="fixed inset-0 z-40 cursor-default pointer-events-auto bg-transparent" 
              onClick={() => setIsEmojiPickerOpen(false)}
            />
            <div className="absolute bottom-full -translate-x-1/2 z-50">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3 }}
                onKeyDown={(e) => {
                  // Manual spam logic: if Enter is held (repeat), keep adding the emoji
                  if (e.key === 'Enter' && lastSelectedEmoji) {
                    handleEmojiSelect(lastSelectedEmoji);
                  }
                }}
                className="p-0 shadow-2xl rounded-2xl overflow-hidden border border-white/10 bg-aura-bg-elevated/95 backdrop-blur-md custom-emoji-picker-container pointer-events-auto"
                style={{ width: 350, height: 400 }}
              >
                <EmojiPicker 
                  theme={Theme.DARK}
                  emojiStyle={EmojiStyle.APPLE}
                  onEmojiClick={(emojiData) => {
                    handleEmojiSelect(emojiData.emoji);
                  }}
                  lazyLoadEmojis={true}
                  autoFocusSearch={false}
                  searchPlaceHolder="Search emoji"
                  previewConfig={{ showPreview: false }}
                  skinTonesDisabled={true}
                  width="100%"
                  height="100%"
                />
              </motion.div>
            </div>
          </Fragment>
        )}
      </AnimatePresence>

      {/* ── Folder Picker Popup (appears above input when '/' typed) ── */}
      <AnimatePresence>
        {showFolderPicker && (
          <FolderPickerPopup
            folders={folders}
            foldersLoading={foldersLoading}
            searchQuery={folderSearch}
            onFolderSelect={(name) => {
              setActiveFolderChip(name);
              let newCursorPos = 0;
              
              setText(prev => {
                const start = slashStartPosRef.current !== -1 ? slashStartPosRef.current : prev.lastIndexOf('/');
                if (start === -1) {
                  const added = `/${name} `;
                  newCursorPos = added.length;
                  return added + prev;
                }
                
                // Find the end of the current slash command word
                const afterSlash = prev.slice(start);
                const match = afterSlash.match(/^\/\S*/);
                const endIdx = match ? start + match[0].length : prev.length;
                
                const before = prev.slice(0, start);
                const after = prev.slice(endIdx).trimStart();
                
                const inserted = `/${name} `;
                newCursorPos = before.length + inserted.length;
                
                return `${before}${inserted}${after}`;
              });
              
              // Focus the textarea and set cursor right after the newly inserted folder name
              setTimeout(() => {
                if (textareaRef.current) {
                  textareaRef.current.focus();
                  textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
                }
              }, 10);
            }}
            onToggleMedia={(item) => {
              setSelectedFolderMedia(prev => {
                const isSelected = prev.some(m => m.messageId === item.messageId);
                if (isSelected) {
                  return prev.filter(m => m.messageId !== item.messageId);
                } else {
                  return [...prev, item];
                }
              });
            }}
            selectedMediaIds={new Set(selectedFolderMedia.map(m => m.messageId))}
            onDismiss={() => {
              setShowFolderPicker(false);
              slashStartPosRef.current = -1;
            }}
          />
        )}
      </AnimatePresence>
      
      <AnimatePresence>
        {replyingTo && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-[720px] mx-auto mb-2 bg-aura-bg-elevated/90 backdrop-blur-md rounded-2xl px-5 py-3 shadow-lg border-l-4 border-l-primary border border-white/5 relative overflow-hidden flex-shrink-0"
          >
            <div className="flex justify-between items-start">
              <div className="flex flex-col flex-1 pr-6 overflow-hidden">
                <span className="text-primary text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">reply</span>
                  Replying to {replyingTo.is_mine ? 'Yourself' : 'Partner'}
                </span>
                <span className="text-aura-text-primary/80 text-sm truncate font-medium flex items-center gap-2">
                  {replyingTo.type === 'image' ? (
                    replyMediaUrl ? (
                      <img src={replyMediaUrl} alt="media preview" className="w-20 h-20 rounded shadow-md object-cover flex-shrink-0" />
                    ) : (
                      <span className="material-symbols-outlined text-[18px] opacity-70 animate-pulse">image</span>
                    )
                  ) : replyingTo.type === 'video' ? (
                    replyMediaUrl ? (
                      <div className="relative w-20 h-20 flex-shrink-0">
                        <video src={replyMediaUrl} className="w-full h-full rounded shadow-md object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded">
                           <span className="material-symbols-outlined text-white text-[16px]">play_circle</span>
                        </div>
                      </div>
                    ) : (
                      <span className="material-symbols-outlined text-[18px] opacity-70 animate-pulse">videocam</span>
                    )
                  ) : null}
                  <span className="truncate">
                    {replyingTo.decrypted_content ? (
                      <EmojiText text={replyingTo.decrypted_content} size={13} />
                    ) : (
                      replyingTo.type !== 'text' ? (replyingTo.type === 'audio' ? 'Voice Message' : '') : 'Message...'
                    )}
                  </span>
                </span>
              </div>
              <button 
                onClick={onCancelReply} 
                className="absolute top-1/2 -translate-y-1/2 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 text-aura-text-secondary hover:text-aura-text-primary hover:bg-white/10 transition-colors z-10"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/10 to-transparent blur-2xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedFolderMedia.length > 0 && !showFolderPicker && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="w-full max-w-[720px] px-4 mb-3"
          >
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pr-4">
              {selectedFolderMedia.map((item) => (
                <div 
                  key={item.messageId} 
                  className="relative shrink-0 w-20 h-20 rounded-2xl overflow-hidden shadow-lg border border-primary/20 group"
                >
                  {item.type === 'video' ? (
                    <div className="w-full h-full relative">
                      <video src={item.decryptedUrl} className="w-full h-full object-cover" muted />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="material-symbols-outlined text-white/70 text-lg">play_circle</span>
                      </div>
                    </div>
                  ) : (
                    <img src={item.decryptedUrl} className="w-full h-full object-cover" alt="" />
                  )}
                  {/* Remove Button */}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFolderMedia(prev => prev.filter(m => m.messageId !== item.messageId));
                    }}
                    className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-white/90 border border-white/10 hover:bg-aura-danger hover:text-white transition-all duration-300 z-20 active:scale-90 shadow-lg"
                    title="Remove media"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>

                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        layout="position"
        className="w-full max-w-[720px] mx-auto flex items-center bg-aura-bg-elevated/80 backdrop-blur-xl rounded-full px-2 py-2 shadow-2xl relative border border-white/10 border-t-white/25">
        {/* Left Action Button (Camera or Emoji) */}
        <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
          <AnimatePresence mode="wait">
            {!text.trim() ? (
              <motion.button
                key="camera-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                onClick={handleCameraClick}
                className="w-full h-full flex items-center justify-center rounded-full text-aura-text-secondary/60 hover:text-primary transition-all active:scale-90"
                title="Camera"
                disabled={disabled || isUploading}
              >
                <span className="material-symbols-outlined text-[24px]">photo_camera</span>
              </motion.button>
            ) : (
              <motion.button
                key="emoji-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => setIsEmojiPickerOpen(true)}
                className="w-full h-full flex items-center justify-center rounded-full text-white transition-all active:scale-90"
                title="Emoji"
                disabled={disabled || isUploading}
              >
                <span className="material-symbols-outlined text-[24px]">sentiment_satisfied</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area */}
        <div className="flex-1 min-h-[40px] flex items-center">
          <div className="relative w-full">
            {/* Auto-complete Suggestion Layer */}
            {suggestion && !activeFolderChip && (
              <div 
                className="absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-sm py-1 px-1 leading-normal z-0"
                style={{ fontFamily: 'inherit' }}
                aria-hidden="true"
              >
                <span className="opacity-0">{text}</span>
                <span className="text-aura-text-secondary opacity-50">{suggestion}</span>
              </div>
            )}

            {/* Mirror Div for styling the prefix while keeping it part of the text */}
            {activeFolderChip && (() => {
              const chipStr = `/${activeFolderChip}`;
              const parts = text.split(chipStr);
              return (
                <div 
                  ref={mirrorRef}
                  className="absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-sm py-1 px-1 leading-normal"
                  style={{ 
                    fontFamily: 'inherit',
                    color: 'var(--text-primary)'
                  }}
                  aria-hidden="true"
                >
                  {parts.map((part, i) => (
                    <Fragment key={i}>
                      <span className="opacity-100">{part}</span>
                      {i < parts.length - 1 && (
                        <span 
                          className="text-white"
                          style={{ textShadow: '0.4px 0 0 white, -0.4px 0 0 white' }}
                        >
                          {chipStr}
                        </span>
                      )}
                    </Fragment>
                  ))}
                </div>
              );
            })()}

          <textarea
            ref={textareaRef}
            value={text}
            onScroll={(e) => {
              if (mirrorRef.current) {
                mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            onBlur={() => {
              lastCursorPosRef.current = textareaRef.current?.selectionStart || 0;
            }}
            onSelect={(e) => {
              lastCursorPosRef.current = e.currentTarget.selectionStart || 0;
            }}
            onClick={() => {
              lastCursorPosRef.current = textareaRef.current?.selectionStart || 0;
            }}
            onChange={(e) => {
              let val = e.target.value;
              lastCursorPosRef.current = e.target.selectionStart || 0;
              if (activeFolderChip) {
                const prefix = `/${activeFolderChip}`;
                if (!val.includes(prefix)) {
                  setActiveFolderChip(null);
                }
              }
              setText(val);
              
              // Close emoji picker if user starts typing
              if (isEmojiPickerOpen) setIsEmojiPickerOpen(false);

              // Detect '/' at start or after whitespace to open folder picker
              const caret = e.target.selectionStart ?? 0;
              const lastSlashIdx = val.lastIndexOf('/', caret);
              if (lastSlashIdx !== -1) {
                const charBefore = lastSlashIdx === 0 ? '' : val[lastSlashIdx - 1];
                const isValidTrigger = (lastSlashIdx === 0 || charBefore === ' ' || charBefore === '\n');
                if (isValidTrigger) {
                  const query = val.slice(lastSlashIdx + 1, caret);
                  // Only show picker if no space yet in query (space = not a slash command)
                  if (!query.includes(' ')) {
                    slashStartPosRef.current = lastSlashIdx;
                    setFolderSearch(query);
                    setShowFolderPicker(true);
                  } else {
                    setShowFolderPicker(false);
                  }
                } else {
                  setShowFolderPicker(false);
                }
              } else {
                setShowFolderPicker(false);
              }
            }}
            onKeyDown={(e) => {
              // Dismiss picker on Escape
              if (e.key === 'Escape' && showFolderPicker) {
                e.preventDefault();
                setShowFolderPicker(false);
                return;
              }
              handleKeyDown(e);
            }}
            onPaste={handlePaste}
            placeholder={isUploading ? "Securing media..." : "I love you..."}
            disabled={disabled || isUploading}
            className={`w-full border-none text-sm resize-none focus:ring-0 focus:outline-none scrollbar-hide py-1 leading-normal px-1 relative z-10 ${
              activeFolderChip 
                ? 'text-transparent caret-white bg-transparent' 
                : 'text-aura-text-primary bg-transparent'
            } placeholder:text-aura-text-secondary/50`}
            style={{ 
              maxHeight: `${maxHeight}px`
            }}
            rows={1}
          />
          </div>
        </div>

        {/* Toggleable Buttons */}
        <div className="flex items-center">
          <AnimatePresence>
            {suggestion && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: 10 }}
                onClick={handleAutoComplete}
                className="mr-2 w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-all active:scale-90"
                title="Auto Complete (Tab)"
              >
                <span className="material-symbols-outlined text-[18px]">keyboard_tab</span>
              </motion.button>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {!text.trim() && !isUploading ? (
              <motion.div 
                key="media-actions"
                initial={{ opacity: 0, scale: 0.8, x: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: 20 }}
                className="flex items-center gap-1"
              >
                <button
                  onClick={() => handleAttachmentSelect('audio')}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-aura-text-secondary/60 hover:text-primary transition-all active:scale-90"
                  title="Audio"
                >
                  <span className="material-symbols-outlined text-[22px]">mic</span>
                </button>
                
                <button
                  onClick={() => setIsMediaGalleryOpen(true)}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-aura-text-secondary/60 hover:text-primary transition-all active:scale-90"
                  title="Media"
                >
                  <span className="material-symbols-outlined text-[22px]">perm_media</span>
                </button>

                <button
                  onClick={() => setIsGifPickerOpen(true)}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-aura-text-secondary/60 hover:text-primary transition-all active:scale-90"
                  title="GIF"
                >
                  <span className="material-symbols-outlined text-[22px]">gif_box</span>
                </button>

                <button
                  onClick={() => setIsAttachmentOpen(true)}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-aura-text-secondary/60 hover:text-primary transition-all active:scale-90"
                  title="More"
                >
                  <span className="material-symbols-outlined text-[22px]">add_circle</span>
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="send-action"
                initial={{ opacity: 0, scale: 0.8, x: -20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: -20 }}
                className="flex items-center"
              >
                {isUploading ? (
                  <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={disabled}
                    className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-primary text-background shadow-glow-gold hover:scale-105 active:scale-95 transition-all duration-300"
                  >
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </motion.div>

        {/* Hidden File Input */}
        <input 
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          multiple
        />

      {typeof document !== 'undefined' ? createPortal(
        <>
          <AttachmentSheet 
            isOpen={isAttachmentOpen}
            onClose={() => setIsAttachmentOpen(false)}
            onSelect={handleAttachmentSelect}
          />

          <MediaGalleryDrawer
            isOpen={isMediaGalleryOpen}
            onClose={() => setIsMediaGalleryOpen(false)}
            onSend={handleGallerySend}
          />

          <MobileCameraModal
            isOpen={isMobileCameraOpen}
            onClose={() => setIsMobileCameraOpen(false)}
            onSend={handleMobileCameraSend}
            onGallerySelect={handleMobileGallerySelect}
          />

          <QualityChoiceModal 
            isOpen={showQualityModal}
            onClose={() => setShowQualityModal(false)}
            onSelect={(opt) => pendingFiles.length > 0 && performUpload(pendingFiles, opt, pendingCaption)}
            fileSize={pendingFiles[0]?.size || 0}
          />

          <AnimatePresence>
            {isStickerPickerOpen && (
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="fixed bottom-0 left-0 right-0 z-[60] h-1/2"
              >
                <StickerPicker 
                  onSelect={(sticker) => {
                    onSend(sticker.emoji, { url: '', media_key: '', media_nonce: '', type: 'sticker' }, replyingTo?.id);
                    if (onCancelReply) onCancelReply();
                    setIsStickerPickerOpen(false);
                  }}
                  onClose={() => setIsStickerPickerOpen(false)}
                />
              </motion.div>
            )}

            {isGifPickerOpen && (
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="fixed bottom-0 left-0 right-0 z-[60] h-1/2"
              >
                <GifPicker 
                    onSelect={(gif) => {
                    // Send as a dedicated 'gif' type message. 
                    // No encryption needed for public Tenor URLs, but we keep the structure consistent.
                    onSend('', { url: gif.url, media_key: '', media_nonce: '', type: 'gif' }, replyingTo?.id);
                    if (onCancelReply) onCancelReply();
                    setIsGifPickerOpen(false);
                  }}
                  onClose={() => setIsGifPickerOpen(false)}
                />
              </motion.div>
            )}

            {isGifPickerOpen && (
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="fixed bottom-0 left-0 right-0 z-[60] h-1/2"
              >
                <GifPicker 
                    onSelect={(gif) => {
                    // Send as a dedicated 'gif' type message. 
                    // No encryption needed for public Tenor URLs, but we keep the structure consistent.
                    onSend('', { url: gif.url, media_key: '', media_nonce: '', type: 'gif' }, replyingTo?.id);
                    if (onCancelReply) onCancelReply();
                    setIsGifPickerOpen(false);
                  }}
                  onClose={() => setIsGifPickerOpen(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      ) : null}
    </footer>
  );
});

export default MessageInput;
