import { useState, useEffect } from 'react';
import { decryptFile } from '../../lib/encryption';

interface EncryptedImageProps {
  url: string | null;
  encryptionKey?: string | null;
  nonce?: string | null;
  alt?: string;
  className?: string;
  placeholder?: string;
}

// Global cache for decrypted image blobs to prevent re-decryption on remounts
const imageCache = new Map<string, string>();

/**
 * EncryptedImage - AURA E2EE Image Viewer
 * Core component to decrypt and display images on the fly.
 */
export default function EncryptedImage({ 
  url, 
  encryptionKey, 
  nonce, 
  alt = 'Encrypted Image', 
  className = '',
  placeholder = 'https://ui-avatars.com/api/?background=1b1b23&color=e6c487'
}: EncryptedImageProps) {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) {
      setDecryptedUrl(null);
      return;
    }

    // If it's a standard URL (not encrypted), just use it
    if (!encryptionKey || !nonce) {
      setDecryptedUrl(url);
      return;
    }

    if (imageCache.has(url)) {
      setDecryptedUrl(imageCache.get(url)!);
      return;
    }

    const decrypt = async () => {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(url);
        const encryptedBuffer = new Uint8Array(await response.arrayBuffer());
        
        const key = new Uint8Array(JSON.parse(encryptionKey));
        const nonceBytes = new Uint8Array(JSON.parse(nonce));
        
        const decryptedData = decryptFile(encryptedBuffer, key, nonceBytes);

        // Detect MIME from magic bytes instead of hardcoding
        const header = decryptedData.slice(0, 4);
        let mime = 'image/jpeg';
        if (header[0] === 0x89 && header[1] === 0x50) mime = 'image/png';
        else if (header[0] === 0x47 && header[1] === 0x49) mime = 'image/gif';
        else if (header[0] === 0x52 && header[1] === 0x49) mime = 'image/webp';

        const blob = new Blob([decryptedData as unknown as BlobPart], { type: mime });
        const objectUrl = URL.createObjectURL(blob);
        
        imageCache.set(url, objectUrl);
        setDecryptedUrl(objectUrl);
      } catch (err) {
        console.error('Decryption failed for image', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    decrypt();

    // Intentionally omitting URL.revokeObjectURL here since we cache the blob URL globally
    // and multiple components might be referring to it.
  }, [url, encryptionKey, nonce]);

  if (loading) {
    return (
      <div className={`animate-pulse bg-[#1b1b23] flex items-center justify-center ${className}`}>
        <span className="material-symbols-outlined text-[#e6c487] animate-spin">sync</span>
      </div>
    );
  }

  if (error || !decryptedUrl) {
    return (
      <img 
        src={placeholder} 
        alt={alt} 
        className={`${className} opacity-50 grayscale`} 
      />
    );
  }

  return (
    <img 
      src={decryptedUrl} 
      alt={alt} 
      className={`transition-all duration-700 ${className}`}
      onLoad={(e) => (e.currentTarget.style.opacity = '1')}
      style={{ opacity: 0 }}
    />
  );
}
