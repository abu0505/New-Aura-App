import { useState } from 'react';
import { useChatSettings } from '../../hooks/useChatSettings';
import { useAuth } from '../../contexts/AuthContext';
import { encryptFile } from '../../lib/encryption';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { supabase } from '../../lib/supabase';
import imageCompression from 'browser-image-compression';

const PRESETS = [
  { id: 'none', name: 'Original', color: '#0d0d15' },
  { id: 'silk', name: 'Dark Silk', color: '#1a1a24' },
  { id: 'stars', name: 'Starfield', color: 'linear-gradient(45deg, #0d0d15 0%, #1b1b23 100%)' },
  { id: 'gold', name: 'Morning Glow', color: 'linear-gradient(135deg, #13131b 0%, #2a2212 100%)' },
];

export default function BackgroundPicker() {
  const { settings, refreshSettings } = useChatSettings();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);

  const handlePresetSelect = async (presetId: string) => {
    const bgUrl = presetId === 'none' ? null : presetId;
    
    const { error } = await supabase.rpc('sync_chat_settings', {
      bg_url: bgUrl,
      bg_key: null,
      bg_nonce: null,
      do_sync: true
    });

    if (error) {
      alert('Failed to set ambience: ' + error.message);
    } else {
      await refreshSettings();
      alert(`Sanctuary ambience changed to: ${PRESETS.find(p => p.id === presetId)?.name}.`);
    }
  };

  const handleCustomUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
      const fileBuffer = new Uint8Array(await compressed.arrayBuffer());
      const { encryptedData, fileKey, nonce } = encryptFile(fileBuffer);
      
      const blob = new Blob([encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
      const { url } = await uploadToCloudinary(new File([blob], 'bg.enc'));

      const { error } = await supabase.rpc('sync_chat_settings', {
        bg_url: url,
        bg_key: JSON.stringify(Array.from(fileKey)),
        bg_nonce: JSON.stringify(Array.from(nonce)),
        do_sync: true
      });

      if (error) {
        alert('Failed to secure background: ' + error.message);
      } else {
        await refreshSettings();
        alert('Custom background applied and secured.');
      }
    } catch (err: any) {
      console.error('Background upload failed', err);
      alert('Sanctuary storage error: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-[#1b1b23]/40 border border-white/5 rounded-[2.5rem] p-8 lg:p-10 shadow-2xl hover:border-[#e6c487]/20 transition-all duration-500 group">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-[#e6c487] group-hover:rotate-12 transition-transform">wallpaper</span>
          <h3 className="font-serif italic text-xl text-white">Chat Ambience</h3>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePresetSelect(preset.id)}
            className={`h-24 rounded-2xl border transition-all relative overflow-hidden group/preset ${
              (preset.id === 'none' ? !settings?.background_url : settings?.background_url === preset.id) ? 'border-[#e6c487] ring-1 ring-[#e6c487]' : 'border-white/10 hover:border-white/30'
            }`}
            style={{ background: preset.color }}
          >
            <span className="absolute bottom-2 left-2 font-label text-[8px] uppercase tracking-widest text-white/40">{preset.name}</span>
            {(preset.id === 'none' ? !settings?.background_url : settings?.background_url === preset.id) && (
              <span className="absolute top-2 right-2 material-symbols-outlined text-[#e6c487] text-sm">check_circle</span>
            )}
          </button>
        ))}
        
        {/* Custom Upload */}
        <label className="h-24 rounded-2xl border border-dashed border-white/20 hover:border-[#e6c487]/40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-white/5">
          {uploading ? (
            <span className="material-symbols-outlined text-[#e6c487] animate-spin">sync</span>
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
        Custom backgrounds are end-to-end encrypted. Your partner's sanctuary will automatically mirror your chosen theme.
      </p>
    </div>
  );
}
