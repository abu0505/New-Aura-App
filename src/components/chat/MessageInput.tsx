import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import AttachmentSheet from './AttachmentSheet';
import MediaGalleryDrawer from './MediaGalleryDrawer';
import AudioRecorder from './AudioRecorder';
import QualityChoiceModal from './QualityChoiceModal';
import { StickerPicker } from './StickerPicker';

import type { ChatMessage } from '../../hooks/useChat';

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
}

const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(({ onSend, onTyping, disabled, replyingTo, onCancelReply, isActive, partnerPublicKey }, ref) => {
  const [text, setText] = useState('');
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingCaption, setPendingCaption] = useState('');
  const [replyMediaUrl, setReplyMediaUrl] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyBlobUrlRef = useRef<string | null>(null);
  const { processAndUpload, getDecryptedBlob } = useMedia();

  useImperativeHandle(ref, () => ({
    handleDroppedFiles: (files: File[]) => {
      if (files.length === 0) return;
      if (files.some(f => f.type.startsWith('image/') || f.type.startsWith('video/'))) {
        setPendingFiles(files);
        setPendingCaption('');
        setShowQualityModal(true);
      } else {
        performUpload(files, false, '');
      }
    },
    focusInput: () => {
      textareaRef.current?.focus();
    }
  }));

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

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
    if ((text.trim() || isUploading) && !disabled) {
      if (isUploading) return;
      clearTypingTimers();
      onTypingRef.current?.(false);
      onSend(text.trim(), undefined, replyingTo?.id);
      setText('');
      if (onCancelReply) onCancelReply();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/') || items[i].type.startsWith('video/')) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      // Prevent pasting the file as text if it's already being handled as a media file
      e.preventDefault();
      setPendingFiles(files);
      setPendingCaption('');
      setShowQualityModal(true);
    }
  };

  const handleAttachmentSelect = (type: string) => {
    // Always close the sheet first to remove z-index blocking
    setIsAttachmentOpen(false);

    if (type === 'audio') {
      // Short delay to let sheet unmount before showing recorder
      setTimeout(() => setIsRecording(true), 150);
    } else if (type === 'location') {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
             // Send as a structured location payload for mini-map rendering
             onSend(`${pos.coords.latitude},${pos.coords.longitude}`, { url: '', media_key: '', media_nonce: '', type: 'location' }, replyingTo?.id);
             if (onCancelReply) onCancelReply();
          },
          () => alert('Location permission denied.')
        );
      } else {
        alert('Geolocation is not supported by your browser.');
      }
    } else if (type === 'sticker') {
      setIsStickerPickerOpen(true);
    } else if (type === 'photo' || type === 'video') {
      setIsMediaGalleryOpen(true);
    } else {
      // Delay file input click until sheet is fully unmounted (animation takes ~300ms)
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.accept = '*/*';
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
    if (files.some(f => f.type.startsWith('image/') || f.type.startsWith('video/'))) {
      setPendingFiles(files);
      setPendingCaption('');
      setShowQualityModal(true);
    } else {
      // Direct upload for all
      performUpload(files, false, '');
    }
  };

  const handleGallerySend = (files: File[], caption: string) => {
    if (files.some(f => f.type.startsWith('image/') || f.type.startsWith('video/'))) {
      setPendingFiles(files);
      setPendingCaption(caption);
      setShowQualityModal(true);
    } else {
      performUpload(files, false, caption);
    }
  };

  const performUpload = async (files: File[], optimize: boolean, caption: string) => {
    setIsUploading(true);
    setShowQualityModal(false);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uploaded = await processAndUpload(file, { optimize });
        if (uploaded) {
          // Send caption only with the very first file
          onSend(i === 0 ? caption.trim() : '', {
            url: uploaded.url,
            media_key: uploaded.media_key,
            media_nonce: uploaded.media_nonce,
            type: uploaded.type
          }, i === 0 ? replyingTo?.id : undefined);
        }
      }
    } finally {
      setIsUploading(false);
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (onCancelReply) onCancelReply();
    }
  };

  const handleAudioComplete = (media: any) => {
    onSend('', media, replyingTo?.id);
    if (onCancelReply) onCancelReply();
    setIsRecording(false);
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
    <footer className="shrink-0 w-full relative z-40 pt-4 pb-4 md:pb-6 px-4 md:px-8 flex flex-col items-center justify-end">
      
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
                  {(replyingTo.type === 'image' || replyingTo.type === 'video') ? (
                    replyMediaUrl ? (
                      <img src={replyMediaUrl} alt="media preview" className="w-20 h-20 rounded shadow-md object-cover flex-shrink-0" />
                    ) : (
                      <span className="material-symbols-outlined text-[18px] opacity-70 animate-pulse">image</span>
                    )
                  ) : null}
                  <span className="truncate">
                    {replyingTo.decrypted_content || (replyingTo.type !== 'text' ? (replyingTo.type === 'audio' ? 'Voice Message' : '') : 'Message...')}
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

      <div className="w-full max-w-[720px] mx-auto flex items-center gap-3 bg-aura-bg-elevated/80 backdrop-blur-xl rounded-full px-4 py-2 shadow-2xl relative border border-white/10 border-t-white/25">
        {/* Input Area */}
        <div className="flex-1 flex items-center min-h-[40px] py-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isUploading ? "Securing media..." : "I love you..."}
            disabled={disabled || isUploading}
            className="w-full pl-3 bg-transparent border-none text-sm text-aura-text-primary placeholder:text-aura-text-secondary/50 resize-none max-h-[120px] focus:ring-0 focus:outline-none scrollbar-hide py-1"
            rows={1}
          />
        </div>

        {/* Toggleable Buttons */}
        <div className="flex items-center">
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

        {/* Hidden File Input */}
        <input 
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          multiple
        />
      </div>

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
          </AnimatePresence>
        </>,
        document.body
      ) : null}
    </footer>
  );
});

export default MessageInput;
