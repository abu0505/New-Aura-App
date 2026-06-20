import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { toast } from 'sonner';

interface UploadReelScreenProps {
  onBack: () => void;
}

export default function UploadReelScreen({ onBack }: UploadReelScreenProps) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const { processAndUpload } = useMedia();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [caption, setCaption] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    validateAndSetFile(file);
  };

  const validateAndSetFile = (file: File) => {
    const isValid = file.type.startsWith('image/') || file.type.startsWith('video/');
    if (!isValid) {
      toast.error('Only images and videos are supported.');
      return;
    }
    
    // Check sizes against FILE_SIZE_LIMITS (50MB image, 200MB video)
    const limit = file.type.startsWith('image/') ? 50 * 1024 * 1024 : 200 * 1024 * 1024;
    if (file.size > limit) {
      toast.error(`File size exceeds the limit (${file.type.startsWith('image/') ? '50MB' : '200MB'})`);
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleUpload = async () => {
    if (!selectedFile || !user || !partner) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      setUploadProgress(30);
      const processed = await processAndUpload(selectedFile);
      if (!processed) throw new Error('Upload failed');

      setUploadProgress(70);

      // Insert as a message with is_reel_upload = true
      // Caption stored in encrypted_content (empty string if none)
      const { error } = await supabase.from('messages').insert({
        sender_id: user.id,
        receiver_id: partner.id,
        encrypted_content: caption || '',
        nonce: '',
        type: processed.type as any,
        media_url: processed.url,
        media_key: processed.media_key,
        media_nonce: processed.media_nonce,
        thumbnail_url: processed.thumbnail_url || null,
        sender_public_key: null,
        is_reel_upload: true,
      } as any);

      if (error) throw error;
      setUploadProgress(100);
      toast.success('🎬 Reel uploaded successfully! It will show up in your feed.');
      
      // Reset state and go back
      clearSelectedFile();
      setCaption('');
      onBack();
    } catch (e: any) {
      console.error('[UploadReelScreen] Upload error:', e);
      toast.error(e?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto flex flex-col pb-24 lg:pb-8">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-white/5">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <h1 className="font-serif italic text-xl text-white">Create Reel</h1>
        <div className="w-10 h-10" /> {/* Spacer */}
      </header>

      {/* Main Layout Area */}
      <div className="w-full flex-grow max-w-6xl mx-auto px-4 py-6 lg:px-8 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-stretch">
          
          {/* Left Side: Drag & Drop / Preview Card */}
          <div className="flex flex-col items-center justify-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {!previewUrl ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full max-w-sm aspect-[9/16] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center gap-4 bg-white/[0.01] hover:bg-white/[0.02] cursor-pointer transition-all duration-300 ${
                  isDragOver
                    ? 'border-[var(--gold)] bg-[var(--gold)]/5 scale-[1.02]'
                    : 'border-white/10 hover:border-[var(--gold)]/40'
                }`}
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#c9a96e]/20 to-[#f0c27f]/10 flex items-center justify-center text-[var(--gold)]">
                  <span className="material-symbols-outlined text-4xl">add_photo_alternate</span>
                </div>
                <div className="text-center px-6">
                  <p className="text-sm font-semibold text-white/80">Choose Photo or Video</p>
                  <p className="text-xs text-white/30 mt-1">Drag and drop file here, or click to browse</p>
                </div>
                <div className="mt-4 px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-[9px] uppercase tracking-wider text-white/40">
                  Max size: Image 50MB • Video 200MB
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm aspect-[9/16] relative rounded-3xl overflow-hidden bg-black shadow-2xl border border-white/10 group">
                {selectedFile?.type.startsWith('video/') ? (
                  <video src={previewUrl} className="w-full h-full object-cover" controls playsInline />
                ) : (
                  <img src={previewUrl} alt="Upload preview" className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 pointer-events-none" />
                
                {/* File Details Badge */}
                <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/5">
                  <span className="material-symbols-outlined text-[13px] text-[var(--gold)]">
                    {selectedFile?.type.startsWith('video/') ? 'movie' : 'image'}
                  </span>
                  <span className="text-[10px] text-white/70 font-semibold uppercase tracking-wider">
                    {selectedFile?.type.startsWith('video/') ? 'Video Reel' : 'Photo Reel'}
                  </span>
                </div>

                {/* Edit Button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white/80 border border-white/10 hover:text-white hover:bg-black/80 transition-all active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                </button>

                {/* Delete/Reset Button */}
                <button
                  onClick={clearSelectedFile}
                  className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-red-500/80 backdrop-blur-md flex items-center justify-center text-white border border-red-500/20 hover:bg-red-500 transition-all active:scale-95"
                  title="Remove file"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>

                {/* File size indicator */}
                {selectedFile && (
                  <div className="absolute bottom-4 left-4 text-[10px] text-white/60 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/5 font-mono">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side: Form details */}
          <div className="flex flex-col justify-between py-2 gap-8">
            <div className="space-y-6">
              
              {/* Caption Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-widest text-white/40">Caption (Optional)</label>
                  <span className="text-[10px] text-white/30 font-mono">{caption.length}/120</span>
                </div>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder="Add a sweet caption or context to your reel..."
                  maxLength={120}
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-[var(--gold)]/40 focus:ring-1 focus:ring-[var(--gold)]/20 transition-all resize-none"
                />
              </div>

              {/* Priority Placement Banner */}
              <div className="bg-[var(--gold)]/5 border border-[var(--gold)]/10 rounded-2xl p-5 space-y-3 relative overflow-hidden">
                <div className="absolute -right-8 -top-8 w-24 h-24 bg-[var(--gold)]/5 rounded-full blur-xl pointer-events-none" />
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[20px] text-[var(--gold)]">stars</span>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--gold)]">Priority Placement</h3>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  Reels uploaded via this creator page get prioritized algorithms in your vault. They will be integrated directly into your partner's feed, showing up <span className="text-[var(--gold)] font-medium">2-3x more frequently</span> than standard photos shared in direct chat messages.
                </p>
              </div>

              {/* Encryption Notice */}
              <div className="bg-emerald-500/[0.02] border border-emerald-500/10 rounded-2xl p-4 flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-emerald-400 mt-0.5">lock</span>
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/90">E2E Encrypted Vault</h4>
                  <p className="text-[11px] text-white/40 leading-normal mt-0.5">
                    Your media is automatically encrypted symmetrically on your device before uploading. It remains completely private and readable only by you and your partner.
                  </p>
                </div>
              </div>
            </div>

            {/* Action/Upload Button Area */}
            <div className="space-y-4">
              {uploading ? (
                <div className="space-y-3 bg-white/[0.02] border border-white/5 p-5 rounded-2xl">
                  <div className="flex justify-between items-center text-xs text-white/70 font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-pulse" />
                      Uploading Encrypted Vault Asset...
                    </span>
                    <span className="font-mono text-[var(--gold)]">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#c9a96e] to-[#f0c27f] rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <p className="text-[10px] text-white/30">Do not close the application or refresh the page while uploading.</p>
                </div>
              ) : (
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile}
                  className="w-full py-4 rounded-2xl font-bold text-sm tracking-widest uppercase transition-all shadow-lg active:scale-[0.98] disabled:opacity-35 disabled:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{
                    background: selectedFile
                      ? 'linear-gradient(135deg, #c9a96e 0%, #f0c27f 50%, #c9a96e 100%)'
                      : 'rgba(255,255,255,0.03)',
                    color: selectedFile ? '#13131b' : 'rgba(255,255,255,0.3)',
                    boxShadow: selectedFile ? '0 10px 25px -5px rgba(201, 169, 110, 0.25)' : 'none',
                    border: selectedFile ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <span className="material-symbols-outlined text-[20px]">upload</span>
                  Upload to Feed
                </button>
              )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
