import { useState } from 'react';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { encryptFile } from '../../lib/encryption';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { supabase } from '../../lib/supabase';
import imageCompression from 'browser-image-compression';
import BackgroundCropper from './BackgroundCropper';

const PRESETS = [
  { id: 'none', name: 'Original', color: 'var(--bg-primary)' },
  { id: 'silk', name: 'Dark Silk', color: '#1a1a24' },
  { id: 'stars', name: 'Starfield', color: 'linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%)' },
  { id: 'gold', name: 'Morning Glow', color: 'linear-gradient(135deg, #13131b 0%, #2a2212 100%)' },
];

export default function BackgroundPicker() {
  const { settings, refreshSettings, updateSettings } = useChatSettingsContext();
  const [uploading, setUploading] = useState(false);
  const [optimisticBg, setOptimisticBg] = useState<string | undefined | null>(undefined);
  const [toast, setToast] = useState<{ message: string, isError: boolean } | null>(null);
  const [showCropper, setShowCropper] = useState(false);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const handlePresetSelect = async (presetId: string) => {
    const bgUrl = presetId === 'none' ? null : presetId;
    setOptimisticBg(bgUrl);
    
    const { error } = await supabase.rpc('sync_chat_settings', {
      bg_url: bgUrl,
      bg_key: null,
      bg_nonce: null,
      do_sync: true
    });

    if (error) {
      setOptimisticBg(undefined);
      showToast('Failed to set background: ' + error.message, true);
    } else {
      await refreshSettings();
      setOptimisticBg(undefined);
      showToast(`Background changed to: ${PRESETS.find(p => p.id === presetId)?.name}.`);
    }
  };

  const handleCropComplete = async (mobileBlob: Blob | null, desktopBlob: Blob | null) => {
    setShowCropper(false);
    if (!mobileBlob && !desktopBlob) return;
    
    setUploading(true);
    try {
      // Parse existing settings to preserve unmodified ones
      let existingMobileUrl = null, existingMobileKey = null, existingMobileNonce = null;
      let existingDesktopUrl = null, existingDesktopKey = null, existingDesktopNonce = null;
      
      if (settings?.background_url?.startsWith('{')) {
        const urls = JSON.parse(settings.background_url);
        const keys = settings.background_key ? JSON.parse(settings.background_key) : {};
        const nonces = settings.background_nonce ? JSON.parse(settings.background_nonce) : {};
        existingMobileUrl = urls.mobile;
        existingMobileKey = keys.mobile;
        existingMobileNonce = nonces.mobile;
        existingDesktopUrl = urls.desktop;
        existingDesktopKey = keys.desktop;
        existingDesktopNonce = nonces.desktop;
      } else {
        existingMobileUrl = settings?.background_url;
        existingMobileKey = settings?.background_key ? JSON.parse(settings.background_key) : null;
        existingMobileNonce = settings?.background_nonce ? JSON.parse(settings.background_nonce) : null;
        existingDesktopUrl = existingMobileUrl;
        existingDesktopKey = existingMobileKey;
        existingDesktopNonce = existingMobileNonce;
      }

      let mobileUploadUrl = existingMobileUrl;
      let mobileUploadKey = existingMobileKey;
      let mobileUploadNonce = existingMobileNonce;

      if (mobileBlob) {
        const mobileCompressed = await imageCompression(new File([mobileBlob], 'mobile.jpg', { type: 'image/jpeg' }), {
          maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true,
        });
        const mobileBuffer = new Uint8Array(await mobileCompressed.arrayBuffer());
        const mobileEnc = encryptFile(mobileBuffer);
        const mobileEncBlob = new Blob([mobileEnc.encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
        const mobileUpload = await uploadToCloudinary(new File([mobileEncBlob], 'mobile_bg.enc'));
        mobileUploadUrl = mobileUpload.url;
        mobileUploadKey = Array.from(mobileEnc.fileKey);
        mobileUploadNonce = Array.from(mobileEnc.nonce);
      }

      let desktopUploadUrl = existingDesktopUrl;
      let desktopUploadKey = existingDesktopKey;
      let desktopUploadNonce = existingDesktopNonce;

      if (desktopBlob) {
        const desktopCompressed = await imageCompression(new File([desktopBlob], 'desktop.jpg', { type: 'image/jpeg' }), {
          maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true,
        });
        const desktopBuffer = new Uint8Array(await desktopCompressed.arrayBuffer());
        const desktopEnc = encryptFile(desktopBuffer);
        const desktopEncBlob = new Blob([desktopEnc.encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
        const desktopUpload = await uploadToCloudinary(new File([desktopEncBlob], 'desktop_bg.enc'));
        desktopUploadUrl = desktopUpload.url;
        desktopUploadKey = Array.from(desktopEnc.fileKey);
        desktopUploadNonce = Array.from(desktopEnc.nonce);
      }

      const urlPayload = JSON.stringify({ mobile: mobileUploadUrl, desktop: desktopUploadUrl });
      const keyPayload = JSON.stringify({ mobile: mobileUploadKey, desktop: desktopUploadKey });
      const noncePayload = JSON.stringify({ mobile: mobileUploadNonce, desktop: desktopUploadNonce });

      setOptimisticBg(urlPayload);
      const { error } = await supabase.rpc('sync_chat_settings', {
        bg_url: urlPayload,
        bg_key: keyPayload,
        bg_nonce: noncePayload,
        do_sync: true
      });

      if (error) {
        setOptimisticBg(undefined);
        showToast('Failed to secure background: ' + error.message, true);
      } else {
        await refreshSettings();
        setOptimisticBg(undefined);
        showToast('Custom background applied and secured.');
      }
    } catch (err: any) {
      setOptimisticBg(undefined);
      showToast('App storage error: ' + err.message, true);
    } finally {
      setUploading(false);
    }
  };

  const currentBg = optimisticBg !== undefined ? optimisticBg : settings?.background_url;

  return (
    <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-[2.5rem] p-6 lg:p-10 shadow-2xl hover:border-[var(--gold)]/20 transition-all duration-500 group relative overflow-hidden">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-[var(--gold)] group-hover:rotate-12 transition-transform">wallpaper</span>
          <h3 className="font-serif italic text-xl text-white">Chat Background</h3>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePresetSelect(preset.id)}
            className={`h-24 rounded-2xl border transition-all relative overflow-hidden group/preset ${
              (preset.id === 'none' ? !currentBg : currentBg === preset.id) ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]' : 'border-white/10 hover:border-white/30'
            }`}
            style={{ background: preset.color }}
          >
            <span className="absolute bottom-2 left-2 font-label text-[8px] uppercase tracking-widest text-white/40">{preset.name}</span>
            {(preset.id === 'none' ? !currentBg : currentBg === preset.id) && (
              <span className="absolute top-2 right-2 material-symbols-outlined text-[var(--gold)] text-sm">check_circle</span>
            )}
          </button>
        ))}
        
        {/* Custom Upload */}
        <button onClick={() => setShowCropper(true)} className="h-24 w-full rounded-2xl border border-dashed border-white/20 hover:border-[var(--gold)]/40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-white/5">
          {uploading ? (
            <span className="material-symbols-outlined text-[var(--gold)] animate-spin">sync</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-white/40">add_photo_alternate</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-white/40">Custom</span>
            </>
          )}
        </button>
      </div>

      {/* Background Image Controls */}
      {currentBg && !['none', 'silk', 'stars', 'gold'].includes(currentBg) && (
        <div className="mb-8 p-6 rounded-[2rem] bg-black/20 border border-white/5 space-y-6">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-white/70 text-lg">image</span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-white font-bold">Background Image</span>
          </div>

          {/* Opacity */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-bold">Image Opacity</span>
              <span className="text-[10px] text-white/50">{Math.round((settings?.bg_opacity ?? 0.30) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={settings?.bg_opacity ?? 0.30}
              onChange={(e) => updateSettings({ bg_opacity: parseFloat(e.target.value) })}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#38bdf8]"
            />
            <span className="text-[9px] text-white/40 italic">How visible the background image is</span>
          </div>

          {/* Blur */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-bold">Blur Intensity</span>
              <span className="text-[10px] text-white/50">{settings?.bg_blur_amount ?? 2}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={settings?.bg_blur_amount ?? 2}
              onChange={(e) => updateSettings({ bg_blur_amount: parseFloat(e.target.value) })}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#38bdf8]"
            />
            <span className="text-[9px] text-white/40 italic">Frosted glass effect on the background</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-white/30 italic leading-relaxed">
        Custom backgrounds are end-to-end encrypted. Your partner's app will automatically mirror your chosen theme.
      </p>

      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full flex items-center gap-3 backdrop-blur-md border shadow-2xl z-50 animate-fade-in ${
          toast.isError ? 'bg-red-950/80 border-red-500/50 text-red-200' : 'bg-[var(--bg-secondary)]/90 border-[var(--gold)]/30 text-[var(--gold)]'
        }`}>
          <span className="material-symbols-outlined text-sm">
            {toast.isError ? 'error' : 'check_circle'}
          </span>
          <span className="font-label text-[10px] uppercase tracking-widest">{toast.message}</span>
        </div>
      )}

      {showCropper && (
        <BackgroundCropper
          onCancel={() => setShowCropper(false)}
          onSave={handleCropComplete}
        />
      )}
    </div>
  );
}
