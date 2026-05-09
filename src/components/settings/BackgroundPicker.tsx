import { useState } from 'react';
import { useChatSettingsContext } from '../../contexts/ChatSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
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
  const { settings, refreshSettings } = useChatSettingsContext();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [optimisticBg, setOptimisticBg] = useState<string | undefined | null>(undefined);
  const [toast, setToast] = useState<{ message: string, isError: boolean } | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

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

  const handleCustomUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  };

  const handleCropComplete = async (mobileBlob: Blob, desktopBlob: Blob) => {
    setCropImageSrc(null);
    setUploading(true);
    try {
      // Process Mobile
      const mobileCompressed = await imageCompression(new File([mobileBlob], 'mobile.jpg', { type: 'image/jpeg' }), {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
      const mobileBuffer = new Uint8Array(await mobileCompressed.arrayBuffer());
      const mobileEnc = encryptFile(mobileBuffer);
      const mobileEncBlob = new Blob([mobileEnc.encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
      const mobileUpload = await uploadToCloudinary(new File([mobileEncBlob], 'mobile_bg.enc'));

      // Process Desktop
      const desktopCompressed = await imageCompression(new File([desktopBlob], 'desktop.jpg', { type: 'image/jpeg' }), {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
      const desktopBuffer = new Uint8Array(await desktopCompressed.arrayBuffer());
      const desktopEnc = encryptFile(desktopBuffer);
      const desktopEncBlob = new Blob([desktopEnc.encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
      const desktopUpload = await uploadToCloudinary(new File([desktopEncBlob], 'desktop_bg.enc'));

      const urlPayload = JSON.stringify({ mobile: mobileUpload.url, desktop: desktopUpload.url });
      const keyPayload = JSON.stringify({ mobile: Array.from(mobileEnc.fileKey), desktop: Array.from(desktopEnc.fileKey) });
      const noncePayload = JSON.stringify({ mobile: Array.from(mobileEnc.nonce), desktop: Array.from(desktopEnc.nonce) });

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
        <label className="h-24 rounded-2xl border border-dashed border-white/20 hover:border-[var(--gold)]/40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-white/5">
          {uploading ? (
            <span className="material-symbols-outlined text-[var(--gold)] animate-spin">sync</span>
          ) : (
            <>
              <span className="material-symbols-outlined text-white/40">add_photo_alternate</span>
              <span className="font-label text-[8px] uppercase tracking-widest text-white/40">Custom</span>
            </>
          )}
          <input type="file" onChange={handleCustomUpload} accept="image/*" className="hidden" />
        </label>
      </div>

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

      {cropImageSrc && (
        <BackgroundCropper
          imageSrc={cropImageSrc}
          onCancel={() => setCropImageSrc(null)}
          onSave={handleCropComplete}
        />
      )}
    </div>
  );
}
