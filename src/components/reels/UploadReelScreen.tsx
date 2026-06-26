import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { useMedia } from '../../hooks/useMedia';
import { toast } from 'sonner';
import { ArrowLeft, ImagePlus, Film, Image, Edit2, Trash2, Sparkles, Lock, Upload, Crop, ChevronLeft, ChevronRight } from 'lucide-react';
import MediaCropperModal from './MediaCropperModal';
import { getVideoDuration, generateVideoThumbnail } from '../../utils/videoChunker';

// ── File size limits ──────────────────────────────────────────────────────────
const IMAGE_SIZE_LIMIT = 50 * 1024 * 1024;          // 50 MB — single-blob path
const VIDEO_SIZE_LIMIT = 1024 * 1024 * 1024;        // 1 GB  — chunked path

const getAspectPreviewClass = (ratio: string) => {
  switch (ratio) {
    case '1:1':  return 'aspect-square';
    case '9:16': return 'aspect-[9/16]';
    case '2:3':  return 'aspect-[2/3]';
    case '4:5':  return 'aspect-[4/5]';
    case '16:9': return 'aspect-[16/9]';
    case '21:9': return 'aspect-[21/9]';
    default:     return 'aspect-[9/16]';
  }
};

interface UploadReelScreenProps {
  onBack: () => void;
}

export default function UploadReelScreen({ onBack }: UploadReelScreenProps) {
  const { user }    = useAuth();
  const { partner } = usePartner();
  const { processAndUpload, processAndUploadChunked } = useMedia();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [selectedFile,    setSelectedFile]    = useState<File | null>(null);
  const [customThumbnailBlob, setCustomThumbnailBlob] = useState<Blob | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [previewUrl,      setPreviewUrl]      = useState<string | null>(null);
  const [uploading,       setUploading]       = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [uploadStatus,    setUploadStatus]    = useState('');
  const [caption,         setCaption]         = useState('');
  const [isDragOver,      setIsDragOver]      = useState(false);
  const [showCropper,     setShowCropper]     = useState(false);
  const [aspectRatio,     setAspectRatio]     = useState('9:16');
  const [customDateEnabled, setCustomDateEnabled] = useState(false);
  const [customDate, setCustomDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    validateAndSetFile(file);
  };

  const validateAndSetFile = (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      toast.error('Only images and videos are supported.');
      return;
    }

    const limit      = isImage ? IMAGE_SIZE_LIMIT : VIDEO_SIZE_LIMIT;
    const limitLabel = isImage ? '50 MB' : '1 GB';
    if (file.size > limit) {
      toast.error(`File too large. Maximum is ${limitLabel}.`);
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setAspectRatio('9:16');

    // Clean up previous custom thumbnail if any
    setCustomThumbnailBlob(null);
    setThumbnailPreviewUrl(null);

    // For videos, generate default first frame thumbnail preview
    if (isVideo) {
      generateVideoThumbnail(file).then(blob => {
        if (blob) {
          const thumbUrl = URL.createObjectURL(blob);
          setThumbnailPreviewUrl(thumbUrl);
        }
      }).catch(err => {
        console.error('Failed to generate initial thumbnail preview:', err);
      });
    }

    if (isImage) setShowCropper(true);
  };

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setAspectRatio('9:16');
    setCustomDateEnabled(false);
    setCustomThumbnailBlob(null);
    setThumbnailPreviewUrl(null);
  };

  const handleCropComplete = (croppedFile: File | null, aspect: string) => {
    setAspectRatio(aspect);
    setShowCropper(false);
    if (croppedFile) {
      setSelectedFile(croppedFile);
      const url = URL.createObjectURL(croppedFile);
      setPreviewUrl(url);
    }
  };

  // Clean up previewUrl when it changes or unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Clean up thumbnailPreviewUrl when it changes or unmounts
  useEffect(() => {
    return () => {
      if (thumbnailPreviewUrl && thumbnailPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(thumbnailPreviewUrl);
      }
    };
  }, [thumbnailPreviewUrl]);

  const handleCaptureCurrentFrame = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    try {
      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 480;
      const h = video.videoHeight || 480;
      const ratio = Math.min(480 / w, 480 / h, 1);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            setCustomThumbnailBlob(blob);
            const url = URL.createObjectURL(blob);
            setThumbnailPreviewUrl(url);
            toast.success('📸 Cover frame set successfully!');
          }
        },
        'image/webp',
        0.75
      );
    } catch (err) {
      console.error('Failed to capture frame:', err);
      toast.error('Could not capture frame. Try pausing the video first.');
    }
  };

  // ── Custom date helper ────────────────────────────────────────────────────

  const buildCustomCreatedAt = (): string | undefined => {
    if (!customDateEnabled || !customDate) return undefined;
    const d   = new Date(customDate);
    const now = new Date();
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return d.toISOString();
  };

  // ── Upload dispatcher ─────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!selectedFile || !user || !partner) return;
    setUploading(true);
    setUploadProgress(5);
    setUploadStatus('Starting...');

    try {
      if (selectedFile.type.startsWith('video/')) {
        await handleVideoUpload();
      } else {
        await handleImageUpload();
      }
    } catch (e: any) {
      console.error('[UploadReelScreen] Upload error:', e);
      toast.error(e?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  // ── Path A: Image — processAndUpload (single encrypted blob, ≤ 50 MB) ─────

  const handleImageUpload = async () => {
    if (!selectedFile || !user || !partner) return;

    setUploadStatus('Encrypting image...');
    setUploadProgress(20);

    const processed = await processAndUpload(selectedFile);
    if (!processed) throw new Error('Image upload failed');

    setUploadProgress(70);
    setUploadStatus('Saving to vault...');

    const payload: any = {
      sender_id:         user.id,
      receiver_id:       partner.id,
      encrypted_content: caption || '',
      nonce:             '',
      type:              processed.type as any,
      media_url:         processed.url,
      media_key:         processed.media_key,
      media_nonce:       processed.media_nonce,
      thumbnail_url:     processed.thumbnail_url || null,
      sender_public_key: null,
      is_reel_upload:    true,
      file_name:         `aspect_ratio:${aspectRatio}`,
    };

    const customCreatedAt = buildCustomCreatedAt();
    if (customCreatedAt) payload.created_at = customCreatedAt;

    const { error } = await supabase.from('messages').insert(payload);
    if (error) throw error;

    setUploadProgress(100);
    toast.success('📸 Photo reel uploaded! It will show up in your feed.');
    clearSelectedFile();
    setCaption('');
    onBack();
  };

  // ── Path B: Video — processAndUploadChunked (up to 1 GB, streaming) ───────
  //
  // Architecture:
  //   1. Get video duration (metadata only — fast)
  //   2. Generate & upload thumbnail first (partner sees it instantly)
  //   3. Pre-insert the messages row with is_reel_upload=true and no media_url
  //      (video lives in video_chunks, not messages.media_url)
  //   4. processAndUploadChunked: split into 1 MB blocks, encrypt each
  //      independently, upload in parallel (max 5 at once), insert a
  //      video_chunks row per block immediately after upload → partner
  //      can start streaming before full upload completes.
  //
  // RAM at peak: ~2–4 MB (one block at a time) vs ~2 GB with a single blob.

  const handleVideoUpload = async () => {
    if (!selectedFile || !user || !partner) return;

    const messageId = crypto.randomUUID();

    // Step 1 — duration
    setUploadStatus('Reading video metadata...');
    setUploadProgress(5);
    const duration = await getVideoDuration(selectedFile);

    // Step 2 — thumbnail
    setUploadStatus('Generating thumbnail...');
    setUploadProgress(10);
    let thumbnailUrl: string | null = null;
    try {
      let thumbBlob = customThumbnailBlob;
      if (!thumbBlob) {
        thumbBlob = await generateVideoThumbnail(selectedFile);
      }
      if (thumbBlob) {
        setUploadStatus('Uploading thumbnail...');
        const thumbFile = new File([thumbBlob], 'thumb.webp', { type: 'image/webp' });
        const uploaded  = await processAndUpload(thumbFile, { optimize: false });
        if (uploaded) thumbnailUrl = uploaded.url;
      }
    } catch {
      // non-fatal — continue without thumbnail
    }

    // Step 3 — pre-insert messages row
    setUploadStatus('Creating reel entry...');
    setUploadProgress(15);

    const customCreatedAt = buildCustomCreatedAt();
    const msgPayload: any = {
      id:                messageId,
      sender_id:         user.id,
      receiver_id:       partner.id,
      encrypted_content: caption || '',
      nonce:             '',
      type:              'video' as any,
      media_url:         null,   // chunked — no single blob URL
      media_key:         null,   // stored per-chunk in video_chunks
      media_nonce:       null,
      thumbnail_url:     thumbnailUrl,
      sender_public_key: null,
      is_reel_upload:    true,
      file_name:         `aspect_ratio:${aspectRatio}`,
    };
    if (customCreatedAt) msgPayload.created_at = customCreatedAt;

    const { error: msgErr } = await supabase.from('messages').insert(msgPayload);
    if (msgErr) throw msgErr;

    // Step 4 — chunked encrypt + upload with live progress
    setUploadProgress(20);
    const success = await processAndUploadChunked(
      selectedFile,
      messageId,
      user.id,
      partner.id,
      (status: string) => {
        setUploadStatus(status);
        // "Uploading X/Y..." → map X/Y to 20–95 % range
        const m = status.match(/(\d+)\/(\d+)/);
        if (m) {
          const done  = parseInt(m[1], 10);
          const total = parseInt(m[2], 10);
          if (total > 0) setUploadProgress(20 + Math.round((done / total) * 75));
        }
      },
      duration
    );

    if (!success) throw new Error('Chunked video upload failed — some chunks could not be uploaded.');

    setUploadProgress(100);
    setUploadStatus('Done!');
    toast.success('🎬 Video reel uploaded! It will show up in your feed.');
    clearSelectedFile();
    setCaption('');
    onBack();
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const isVideo    = selectedFile?.type.startsWith('video/') ?? false;
  const fileSizeGB = selectedFile ? selectedFile.size >= 1024 * 1024 * 1024 : false;
  const fileSizeLabel = selectedFile
    ? fileSizeGB
      ? `${(selectedFile.size / 1024 / 1024 / 1024).toFixed(2)} GB`
      : `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
    : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] overflow-y-auto flex flex-col pb-24 lg:pb-8">

      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/80 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-white/5">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-serif italic text-xl text-white">Create Reel</h1>
        <div className="w-10 h-10" />
      </header>

      {/* Content */}
      <div className="w-full flex-grow max-w-6xl mx-auto px-4 py-6 lg:px-8 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-stretch">

          {/* ── Left: Drop zone / Preview ── */}
          <div className="flex flex-col items-center justify-start lg:pt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {!previewUrl ? (
              /* Drop zone */
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
                  <ImagePlus size={32} />
                </div>
                <div className="text-center px-6">
                  <p className="text-sm font-semibold text-white/80">Choose Photo or Video</p>
                  <p className="text-xs text-white/30 mt-1">Drag and drop or click to browse</p>
                </div>
                <div className="mt-4 px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-[9px] uppercase tracking-wider text-white/40">
                  Image ≤ 50 MB · Video ≤ 1 GB
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                {/* Preview card */}
                <div className={`w-full max-w-sm ${getAspectPreviewClass(aspectRatio)} relative rounded-3xl overflow-hidden bg-black shadow-2xl border border-white/10 transition-all duration-300`}>
                  {isVideo ? (
                    <video ref={videoRef} src={previewUrl} className="w-full h-full object-cover" controls playsInline />
                  ) : (
                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 pointer-events-none" />

                  {/* Type badge */}
                  <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/5">
                    {isVideo
                      ? <Film  className="w-3.5 h-3.5 text-[var(--gold)]" />
                      : <Image className="w-3.5 h-3.5 text-[var(--gold)]" />}
                    <span className="text-[10px] text-white/70 font-semibold uppercase tracking-wider">
                      {isVideo ? 'Video Reel' : 'Photo Reel'}
                    </span>
                  </div>

                  {/* Chunked-upload indicator for large videos */}
                  {isVideo && selectedFile && selectedFile.size > 200 * 1024 * 1024 && (
                    <div className="absolute top-[52px] left-4 flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Chunked · up to 1 GB</span>
                    </div>
                  )}

                  {/* Crop / aspect ratio */}
                  <button
                    onClick={() => setShowCropper(true)}
                    className="absolute top-4 right-14 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white/80 border border-white/10 hover:text-white hover:bg-black/80 transition-all active:scale-95"
                    title={isVideo ? 'Set aspect ratio' : 'Crop / Aspect ratio'}
                  >
                    <Crop size={16} className="text-[var(--gold)]" />
                  </button>

                  {/* Change file */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white/80 border border-white/10 hover:text-white hover:bg-black/80 transition-all active:scale-95"
                    title="Choose another file"
                  >
                    <Edit2 size={16} />
                  </button>

                  {/* Remove */}
                  <button
                    onClick={clearSelectedFile}
                    className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-red-500/80 backdrop-blur-md flex items-center justify-center text-white border border-red-500/20 hover:bg-red-500 transition-all active:scale-95"
                    title="Remove file"
                  >
                    <Trash2 size={18} />
                  </button>

                  {/* File size */}
                  {selectedFile && (
                    <div className="absolute bottom-4 left-4 text-[10px] text-white/60 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/5 font-mono">
                      {fileSizeLabel}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Form ── */}
          <div className="flex flex-col justify-between py-2 gap-8">
            <div className="space-y-6">

              {/* Caption */}
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

              {/* Cover / Thumbnail Selection */}
              {isVideo && (
                <div className="w-full bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-[var(--gold)]" />
                      Reel Cover Frame
                    </span>
                    {customThumbnailBlob ? (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        Custom Cover
                      </span>
                    ) : (
                      <span className="text-[9px] bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        Default Frame
                      </span>
                    )}
                  </div>

                  <div className="flex gap-4 items-center">
                    {/* Visual preview of chosen cover */}
                    <div className="w-16 h-24 rounded-xl bg-black border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                      {thumbnailPreviewUrl ? (
                        <img src={thumbnailPreviewUrl} className="w-full h-full object-cover" alt="Cover preview" />
                      ) : (
                        <div className="text-[10px] text-white/30 text-center font-medium">No Cover</div>
                      )}
                    </div>

                    <div className="flex-1 space-y-2.5">
                      <p className="text-[11px] text-white/40 leading-normal">
                        Play or seek the video to the frame you want to use, pause it, then click the button below.
                      </p>
                      
                      <button
                        type="button"
                        onClick={handleCaptureCurrentFrame}
                        className="w-full py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 hover:border-[var(--gold)]/30 text-xs font-semibold text-white/95 rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[var(--gold)]" />
                        Use Current Frame
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Custom date */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold uppercase tracking-wider text-white/80">Set Custom Date</span>
                    <span className="text-[10px] text-white/40 mt-0.5">Upload for a past anniversary or event</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customDateEnabled}
                      onChange={e => setCustomDateEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white/80 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--gold)]" />
                  </label>
                </div>

                <AnimatePresence>
                  {customDateEnabled && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <CustomDatePicker
                        value={customDate}
                        onChange={setCustomDate}
                      />
                      <p className="text-[10px] text-white/30 leading-relaxed">
                        This media will be placed in history on your selected date. The algorithm will automatically place it in the correct nostalgia bucket (recent, middle, or old).
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* E2E notice */}
              <div className="bg-emerald-500/[0.02] border border-emerald-500/10 rounded-2xl p-4 flex items-start gap-3">
                <Lock className="w-[18px] h-[18px] text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/90">E2E Encrypted Vault</h4>
                  <p className="text-[11px] text-white/40 leading-normal mt-0.5">
                    {isVideo
                      ? 'Your video is encrypted chunk-by-chunk (1 MB blocks) before uploading. Even a 1 GB file uses only ~2–4 MB of RAM at a time.'
                      : 'Your photo is encrypted on your device before uploading. Readable only by you and your partner.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Upload button / progress */}
            <div className="space-y-4">
              {uploading ? (
                <div className="space-y-3 bg-white/[0.02] border border-white/5 p-5 rounded-2xl">
                  <div className="flex justify-between items-center text-xs text-white/70 font-semibold">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-[var(--gold)] animate-pulse shrink-0" />
                      <span className="truncate">{uploadStatus || 'Uploading...'}</span>
                    </span>
                    <span className="font-mono text-[var(--gold)] shrink-0 ml-2">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#c9a96e] to-[#f0c27f] rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <p className="text-[10px] text-white/30">
                    {isVideo
                      ? 'Video uploads in encrypted chunks — keep the app open or let Android upload in the background.'
                      : 'Do not close the app while uploading.'}
                  </p>
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
                    color:     selectedFile ? '#13131b' : 'rgba(255,255,255,0.3)',
                    boxShadow: selectedFile ? '0 10px 25px -5px rgba(201, 169, 110, 0.25)' : 'none',
                    border:    selectedFile ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <Upload size={20} />
                  {isVideo ? 'Upload Video Reel' : 'Upload to Feed'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cropper modal */}
      {showCropper && previewUrl && (
        <MediaCropperModal
          mediaSrc={previewUrl}
          mediaType={isVideo ? 'video' : 'image'}
          initialAspect={aspectRatio}
          onCropComplete={handleCropComplete}
          onCancel={() => setShowCropper(false)}
        />
      )}
    </div>
  );
}

interface CustomDatePickerProps {
  value: string;
  onChange: (value: string) => void;
}

function CustomDatePicker({ value, onChange }: CustomDatePickerProps) {
  const [year, month] = value.split('-').map(Number);
  const [viewMonth, setViewMonth] = useState(month - 1);
  const [viewYear, setViewYear] = useState(year);

  useEffect(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      setViewMonth(m - 1);
      setViewYear(y);
    }
  }, [value]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const startYear = 1980;
  const endYear = today.getFullYear();
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) {
    years.push(y);
  }

  const getDaysInMonth = (y: number, m: number) => {
    return new Date(y, m + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (y: number, m: number) => {
    return new Date(y, m, 1).getDay();
  };

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
  const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(prev => prev - 1);
    } else {
      setViewMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    if (nextY > today.getFullYear() || (nextY === today.getFullYear() && nextM > today.getMonth())) {
      return;
    }
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(prev => prev + 1);
    } else {
      setViewMonth(prev => prev + 1);
    }
  };

  const selectDay = (d: number, m: number, y: number) => {
    const formattedDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    onChange(formattedDate);
  };

  const setRelativeDate = (yearsAgo: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - yearsAgo);
    const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    onChange(formatted);
  };

  const gridCells = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    gridCells.push({
      day: d,
      month: prevMonth,
      year: prevYear,
      isCurrentMonth: false,
      dateStr: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    gridCells.push({
      day: d,
      month: viewMonth,
      year: viewYear,
      isCurrentMonth: true,
      dateStr: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    });
  }

  const totalCells = gridCells.length;
  const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  for (let d = 1; d <= remainingCells; d++) {
    gridCells.push({
      day: d,
      month: nextMonth,
      year: nextYear,
      isCurrentMonth: false,
      dateStr: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    });
  }

  return (
    <div className="w-full bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-4 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[var(--gold)]/40 transition-all font-medium cursor-pointer"
          >
            {months.map((m, idx) => {
              const isFuture = viewYear === today.getFullYear() && idx > today.getMonth();
              return (
                <option key={m} value={idx} disabled={isFuture} className="bg-zinc-950 text-white">
                  {m}
                </option>
              );
            })}
          </select>

          <select
            value={viewYear}
            onChange={(e) => {
              const y = Number(e.target.value);
              setViewYear(y);
              if (y === today.getFullYear() && viewMonth > today.getMonth()) {
                setViewMonth(today.getMonth());
              }
            }}
            className="bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[var(--gold)]/40 transition-all font-medium cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-zinc-950 text-white">
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-all active:scale-95"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            disabled={viewYear === today.getFullYear() && viewMonth >= today.getMonth()}
            className="p-1.5 rounded-lg hover:bg-white/5 text-white/60 hover:text-white transition-all active:scale-95 disabled:opacity-20 disabled:pointer-events-none"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-white/30 uppercase tracking-wider font-mono">
        <span>Su</span>
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center font-mono">
        {gridCells.map((cell, idx) => {
          const isSelected = cell.dateStr === value;
          const isToday = cell.dateStr === todayStr;
          const isFuture = (cell.year > today.getFullYear()) ||
                           (cell.year === today.getFullYear() && cell.month > today.getMonth()) ||
                           (cell.year === today.getFullYear() && cell.month === today.getMonth() && cell.day > today.getDate());

          return (
            <button
              key={`${cell.dateStr}-${idx}`}
              type="button"
              disabled={isFuture}
              onClick={() => selectDay(cell.day, cell.month, cell.year)}
              className={`
                aspect-square flex items-center justify-center text-xs rounded-full transition-all relative
                ${!cell.isCurrentMonth ? 'text-white/20' : 'text-white/80'}
                ${isFuture ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/5 cursor-pointer'}
                ${isSelected ? 'bg-gradient-to-br from-[#c9a96e] to-[#f0c27f] text-black font-bold shadow-lg shadow-[#c9a96e]/15 hover:from-[#c9a96e] hover:to-[#f0c27f]' : ''}
                ${isToday && !isSelected ? 'border border-[var(--gold)]/40 text-[var(--gold)] font-bold' : ''}
              `}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="pt-3 border-t border-white/5 space-y-2">
        <div className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Quick Shortcuts</div>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 5, 10].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setRelativeDate(y)}
              className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--gold)]/25 text-[10px] text-white/70 hover:text-white rounded-lg transition-all active:scale-95"
            >
              {y} {y === 1 ? 'Year' : 'Years'} Ago
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
