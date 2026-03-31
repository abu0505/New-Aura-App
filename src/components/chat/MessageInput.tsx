import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';
import AttachmentSheet from './AttachmentSheet';
import AudioRecorder from './AudioRecorder';
import QualityChoiceModal from './QualityChoiceModal';
import { StickerPicker } from './StickerPicker';

import type { ChatMessage } from '../../hooks/useChat';

interface MessageInputProps {
  onSend: (text: string, media?: { url: string, media_key: string, media_nonce: string, type: string }, replyToId?: string) => void;
  onTyping?: (isTyping: boolean) => void;
  disabled?: boolean;
  replyingTo?: ChatMessage | null;
  onCancelReply?: () => void;
}

export default function MessageInput({ onSend, onTyping, disabled, replyingTo, onCancelReply }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { processAndUpload } = useMedia();

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

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
    } else {
      // Delay file input click until sheet is fully unmounted (animation takes ~300ms)
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.accept =
            type === 'photo' || type === 'camera' ? 'image/*' :
            type === 'video' ? 'video/*' : '*/*';
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
      setShowQualityModal(true);
    } else {
      // Direct upload for all
      performUpload(files, false, '');
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
      <div className="px-6 py-4 bg-[#0d0d15]/80 backdrop-blur-3xl border-t border-white/5">
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
    <footer className="shrink-0 w-full relative z-40 pt-4 pb-4 md:pb-6 px-4 md:px-8 flex flex-col items-center justify-end bg-gradient-to-t from-[#0d0d15] via-[#0d0d15] to-transparent">
      
      <AnimatePresence>
        {replyingTo && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-[720px] mx-auto mb-2 bg-[#292932]/90 backdrop-blur-md rounded-2xl px-5 py-3 shadow-lg border-l-4 border-l-[#e6c487] border border-white/5 relative overflow-hidden flex-shrink-0"
          >
            <div className="flex justify-between items-start">
              <div className="flex flex-col flex-1 pr-6 overflow-hidden">
                <span className="text-[#e6c487] text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">reply</span>
                  Replying to {replyingTo.is_mine ? 'Yourself' : 'Partner'}
                </span>
                <span className="text-[#e4e1ed]/80 text-sm truncate font-medium">
                  {replyingTo.decrypted_content || (replyingTo.type !== 'text' ? `[${replyingTo.type}]` : 'Message...')}
                </span>
              </div>
              <button 
                onClick={onCancelReply} 
                className="absolute top-1/2 -translate-y-1/2 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 text-[#998f81] hover:text-[#e4e1ed] hover:bg-white/10 transition-colors z-10"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#e6c487]/10 to-transparent blur-2xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-[720px] mx-auto flex items-center gap-3 bg-[#1b1b23]/80 backdrop-blur-xl rounded-full px-4 py-2 shadow-2xl relative border-t border-white/5">
        {/* Input Area */}
        <div className="flex-1 flex items-center min-h-[40px] py-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isUploading ? "Securing media..." : "Write something beautiful..."}
            disabled={disabled || isUploading}
            className="w-full pl-3 bg-transparent border-none text-sm text-[#e4e1ed] placeholder:text-[#998f81]/50 placeholder:italic resize-none max-h-[120px] focus:ring-0 focus:outline-none scrollbar-hide py-1"
            rows={1}
          />
        </div>

        {/* Attachment Button */}
        <button
          onClick={() => setIsAttachmentOpen(true)}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-[#998f81]/60 hover:text-[#e6c487] transition-all active:scale-90"
        >
          <span className="material-symbols-outlined text-2xl">add_circle</span>
        </button>

        {/* Send Button */}
        <AnimatePresence mode="popLayout">
          {isUploading ? (
            <div className="w-10 h-10 shrink-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-[#e6c487] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <motion.button
              key="send"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-full transition-all duration-300 ${
                text.trim() 
                  ? 'bg-[#e6c487] text-[#0d0d15] shadow-[0_0_15px_rgba(230,196,135,0.15)] hover:scale-105 active:scale-95' 
                  : 'bg-[#34343d]/50 text-[#998f81]/40 grayscale cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
            </motion.button>
          )}
        </AnimatePresence>

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

          <QualityChoiceModal 
            isOpen={showQualityModal}
            onClose={() => setShowQualityModal(false)}
            onSelect={(opt) => pendingFiles.length > 0 && performUpload(pendingFiles, opt, '')}
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
}
