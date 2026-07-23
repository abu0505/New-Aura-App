import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';
import { encryptFile } from '../../lib/encryption';
import { uploadToCloudinary } from '../../lib/cloudinary';
import imageCompression from 'browser-image-compression';
import EncryptedImage from '../common/EncryptedImage';
import ImageCropperModal from '../common/ImageCropperModal';
import MemoryImagePicker from '../common/MemoryImagePicker';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlatform } from '../../hooks/usePlatform';
import { App as CapacitorApp } from '@capacitor/app';

export default function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const { partner } = usePartner();
  const { isNative } = usePlatform();
  const [appVersion, setAppVersion] = useState('2.25.11');


  useEffect(() => {
    async function fetchVersion() {
      if (isNative) {
        try {
          const info = await CapacitorApp.getInfo();
          if (info && info.version) {
            setAppVersion(info.version);
          }
        } catch (error) {
          console.error('Error fetching native app version:', error);
        }
      }
    }
    fetchVersion();
  }, [isNative]);

  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || '');
  const [uploading, setUploading] = useState(false);
  const [selectedImageToCrop, setSelectedImageToCrop] = useState<string | null>(null);
  const [showSourceOptions, setShowSourceOptions] = useState(false);
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameUpdateInProgress = useRef(false);

  const handleUpdateName = async () => {
    if (!displayName.trim() || !user || nameUpdateInProgress.current) return;
    nameUpdateInProgress.current = true;
    
    // Optimistic: close editor immediately
    setEditingName(false);

    try {
      const [authResult] = await Promise.all([
        supabase.auth.updateUser({ data: { display_name: displayName.trim() } }),
        supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', user.id),
      ]);

      if (authResult.error) {
        toast.error('Failed to update identity', {
          description: authResult.error.message,
        });
      }
      await refreshUser();
    } finally {
      nameUpdateInProgress.current = false;
    }
  };

  const handleAvatarClick = () => {
    setShowSourceOptions(true);
  };

  const handleDeviceUpload = () => {
    setShowSourceOptions(false);
    fileInputRef.current?.click();
  };

  const handleChooseFromMemories = () => {
    setShowSourceOptions(false);
    setShowMemoryPicker(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Create a local object URL for the cropper to display
    const fileUrl = URL.createObjectURL(file);
    setSelectedImageToCrop(fileUrl);
    
    // Clear the input so the exact same file can be selected again if cancelled
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMemorySelect = (blob: Blob) => {
    const fileUrl = URL.createObjectURL(blob);
    setSelectedImageToCrop(fileUrl);
  };

  const handleCropComplete = async (croppedFile: File) => {
    if (!user) return;

    // Clean up
    if (selectedImageToCrop) {
      URL.revokeObjectURL(selectedImageToCrop);
    }
    setSelectedImageToCrop(null);

    setUploading(true);
    try {
      // 1. Compress
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      };
      const compressedFile = await imageCompression(croppedFile, options);
      
      // 2. Encrypt (Avatar is personal, but we'll encrypt it for the vault theme)
      // Actually, for avatar, we can use standard upload if we want it public,
      // but AURA PRD says "Encrypt media same as chat attachments".
      // Let's use standard for avatar display in notifications, etc., but we can store it encrypted if needed.
      // PRD says: "Profile photos are also E2EE".
      
      const fileBuffer = new Uint8Array(await compressedFile.arrayBuffer());
      const { encryptedData, fileKey, nonce } = encryptFile(fileBuffer);
      
      // 3. Upload encrypted blob
      const blob = new Blob([encryptedData as unknown as BlobPart], { type: 'application/octet-stream' });
      const { url } = await uploadToCloudinary(new File([blob], 'avatar.enc'));
      
      // 4. Update user metadata AND profiles table in parallel
      const keyArray = Array.from(fileKey);
      const nonceArray = Array.from(nonce);
      const [authResult] = await Promise.all([
        supabase.auth.updateUser({
          data: { avatar_url: url, avatar_key: keyArray, avatar_nonce: nonceArray }
        }),
        supabase.from('profiles').update({ 
          avatar_url: url,
          avatar_key: JSON.stringify(keyArray),
          avatar_nonce: JSON.stringify(nonceArray)
        }).eq('id', user.id),
      ]);

      if (authResult.error) {
        toast.error('Authentication update failed', {
          description: authResult.error.message,
        });
      } else {
        await refreshUser();
      }
    } catch (err: any) {
      
      toast.error('App storage error', {
        description: err.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCropCancel = () => {
    if (selectedImageToCrop) {
      URL.revokeObjectURL(selectedImageToCrop);
    }
    setSelectedImageToCrop(null);
  };

  return (
    <section className="relative px-2 pt-20 pb-10 lg:pt-32 lg:pb-24 border-b border-white/5 bg-gradient-to-b from-[var(--bg-secondary)]/50 to-transparent safe-top">
      <div className="max-w-4xl mx-auto flex flex-col lg:flex-row items-center gap-12">
        {/* Avatar Handle */}
        <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
          <div className="w-32 h-32 lg:w-48 lg:h-48 rounded-[3rem] border-2 border-[var(--gold)] p-1.5 shadow-3xl overflow-hidden transition-transform duration-700 group-hover:scale-105">
            {uploading ? (
              <div className="w-full h-full bg-[var(--bg-secondary)] flex items-center justify-center animate-pulse">
                <span className="material-symbols-outlined text-[var(--gold)] animate-spin">sync</span>
              </div>
            ) : (
              <EncryptedImage 
                url={user?.user_metadata?.avatar_url}
                encryptionKey={user?.user_metadata?.avatar_key ? (typeof user.user_metadata.avatar_key === 'string' ? user.user_metadata.avatar_key : JSON.stringify(user.user_metadata.avatar_key)) : null}
                nonce={user?.user_metadata?.avatar_nonce ? (typeof user.user_metadata.avatar_nonce === 'string' ? user.user_metadata.avatar_nonce : JSON.stringify(user.user_metadata.avatar_nonce)) : null}
                alt="Your Avatar" 
                className="w-full h-full object-cover rounded-[2.5rem]" 
                placeholder={`https://ui-avatars.com/api/?name=${user?.user_metadata?.display_name || 'You'}&background=c9a96e&color=000000`}
              />
            )}
          </div>
          <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-[var(--gold)] text-black rounded-2xl flex items-center justify-center shadow-xl group-hover:rotate-12 transition-transform">
            <span className="material-symbols-outlined text-sm">edit</span>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />
        </div>

        {/* Identity Info */}
        <div className="text-center lg:text-left flex-1">
          {editingName ? (
            <div className="flex flex-col items-center lg:items-start gap-4 mb-4">
              <input 
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-white/5 border-b border-[var(--gold)] text-[var(--gold)] font-serif italic text-4xl lg:text-5xl outline-none px-2 py-1 w-full max-w-md"
                autoFocus
                onBlur={handleUpdateName}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
              />
              <p className="text-[10px] uppercase tracking-widest text-white/40">Press Enter to save</p>
            </div>
          ) : (
            <h1 
              className="font-serif italic text-4xl lg:text-6xl text-[var(--gold)] mb-4 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setEditingName(true)}
            >
              {user?.user_metadata?.display_name || 'Aura User'}
            </h1>
          )}
          
          <p className="font-label text-xs uppercase tracking-[0.4em] text-white/40 mb-8">Synchronized with {partner?.display_name || 'Partner'}</p>
          
          <div className="flex flex-wrap justify-center lg:justify-start gap-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-3">
              <span className="material-symbols-outlined text-[var(--gold)] text-sm">verified_user</span>
              <span className="font-label text-[10px] tracking-widest text-white/60">E2E SECURED</span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-3">
              <span className="material-symbols-outlined text-[var(--gold)] text-sm">cloud_done</span>
              <span className="font-label text-[10px] tracking-widest text-white/60">MEMENTO SYNC ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Source Options Dialog */}
      <AnimatePresence>
        {showSourceOptions && (
          <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowSourceOptions(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--bg-secondary)] border border-white/10 rounded-3xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="font-serif italic text-lg text-[var(--gold)] mb-4 text-center">Update Profile Picture</h3>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleDeviceUpload}
                  className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-white text-sm font-medium tracking-wide flex items-center justify-center gap-2 transition-all"
                >
                  <span className="material-symbols-outlined text-lg">upload</span>
                  Upload from Device
                </button>
                <button
                  onClick={handleChooseFromMemories}
                  className="w-full py-3 rounded-2xl bg-[var(--gold)] text-black font-bold text-sm tracking-wide flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-[var(--gold)]/15"
                >
                  <span className="material-symbols-outlined text-lg">photo_library</span>
                  Choose from Memories
                </button>
                <button
                  onClick={() => setShowSourceOptions(false)}
                  className="w-full py-3 rounded-2xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/5 transition-all mt-2"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Memory Picker */}
      <MemoryImagePicker
        isOpen={showMemoryPicker}
        onClose={() => setShowMemoryPicker(false)}
        onSelect={handleMemorySelect}
      />

      {selectedImageToCrop && (
        <ImageCropperModal
          imageSrc={selectedImageToCrop}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* App Version Tag */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center opacity-30 pointer-events-none">
        <p className="font-label text-[8px] uppercase tracking-[0.45em] text-white">
          Version {appVersion} • {isNative ? 'Native' : 'Web'}
        </p>
      </div>
    </section>
  );
}
