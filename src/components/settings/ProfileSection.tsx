import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { supabase } from '../../lib/supabase';
import { encryptFile } from '../../lib/encryption';
import { uploadToCloudinary } from '../../lib/cloudinary';
import imageCompression from 'browser-image-compression';
import EncryptedImage from '../common/EncryptedImage';
import ImageCropperModal from '../common/ImageCropperModal';

export default function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const { partner } = usePartner();
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || '');
  const [uploading, setUploading] = useState(false);
  const [selectedImageToCrop, setSelectedImageToCrop] = useState<string | null>(null);
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
    fileInputRef.current?.click();
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
    <section className="relative px-2 pt-20 pb-10 lg:pt-32 lg:pb-24 border-b border-white/5 bg-gradient-to-b from-[var(--bg-secondary)]/50 to-transparent">
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

      {selectedImageToCrop && (
        <ImageCropperModal
          imageSrc={selectedImageToCrop}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </section>
  );
}
