import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { useAuth } from '../contexts/AuthContext';
import {
  getStoredKeyPair,
  encryptFile,
  decryptFile,
  encryptFileKey,
  decryptFileKeyWithFallback,
  decodeBase64,
  encodeBase64
} from '../lib/encryption';
import { usePartner } from './usePartner';

export interface ProcessedMedia {
  url: string;
  thumbnail_url?: string;
  media_key: string; // The wrapped symmetric key
  media_key_nonce: string; // Nonce for the wrapped key
  media_nonce: string; // Nonce for the symmetric-encrypted data
  type: 'image' | 'video' | 'audio' | 'document';
  name?: string;
  size?: number;
}

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

export function useMedia() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const generateThumbnail = async (file: File): Promise<Blob | null> => {
    if (!file.type.startsWith('image/')) return null;
    try {
      const options = {
        maxSizeMB: 0.05,
        maxWidthOrHeight: 200,
        useWebWorker: true,
      };
      return await imageCompression(file, options);
    } catch (e) {
      console.error('Thumbnail generation failed', e);
      return null;
    }
  };

  const processAndUpload = async (
    file: File, 
    options: { optimize?: boolean } = { optimize: true }
  ): Promise<ProcessedMedia | null> => {
    if (!user || !partner?.public_key) return null;

    setIsProcessing(true);
    setUploadProgress(0);
    
    try {
      const myKeyPair = getStoredKeyPair();
      if (!myKeyPair) throw new Error('Private key missing');

      let fileToProcess = file;

      // 1. Optimization
      if (options.optimize) {
        if (file.type.startsWith('image/')) {
          fileToProcess = await imageCompression(file, {
            maxSizeMB: 2,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
          });
        } else if (file.type.startsWith('video/')) {
          // Video compression with FFmpeg
          if (!ffmpegInstance) {
            ffmpegInstance = new FFmpeg();
          }
          if (!ffmpegLoaded) {
            await ffmpegInstance.load();
            ffmpegLoaded = true;
          }
          
          ffmpegInstance.on('progress', ({ progress }) => {
            setUploadProgress(Math.round(progress * 100));
          });

          const inputName = 'input' + (file.name.substring(file.name.lastIndexOf('.')) || '.mp4');
          const outputName = 'output.mp4';

          await ffmpegInstance.writeFile(inputName, await fetchFile(file));
          await ffmpegInstance.exec([
            '-i', inputName, 
            '-c:v', 'libx264', 
            '-crf', '28', 
            '-vf', 'scale=-2:720', 
            '-preset', 'veryfast', 
            outputName
          ]);

          const data = await ffmpegInstance.readFile(outputName);
          fileToProcess = new File([data as any], file.name, { type: 'video/mp4' });
        }
      }

      // 2. Encryption (Symmetric)
      const arrayBuffer = await fileToProcess.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const { encryptedData, fileKey, nonce } = encryptFile(uint8Array);

      // 3. Wrap Key (Asymmetric)
      const { encryptedKey, nonce: keyNonce } = encryptFileKey(fileKey, decodeBase64(partner.public_key), myKeyPair.secretKey);

      // 4. Upload Ciphertext
      const uploadFile = async (data: Uint8Array, type: 'raw' | 'image' = 'raw', filename?: string) => {
        const formData = new FormData();
        formData.append('file', new Blob([data as any]), filename || 'encrypted_file.raw');
        formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
        
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/${type}/upload`,
          { method: 'POST', body: formData }
        );
        if (!response.ok) throw new Error('Upload failed');
        return await response.json();
      };

      const uploadResult = await uploadFile(encryptedData, 'raw', fileToProcess.name);
      
      // 5. Generate and upload thumbnail (unencrypted for fast preview speed, or encrypted?)
      let thumbnailUrl = '';
      const thumbBlob = await generateThumbnail(file);
      if (thumbBlob) {
        const thumbBuffer = await thumbBlob.arrayBuffer();
        const { encryptedData: thumbCipher } = encryptFile(new Uint8Array(thumbBuffer));
        const thumbResult = await uploadFile(thumbCipher, 'raw');
        thumbnailUrl = thumbResult.secure_url;
      }

      return {
        url: uploadResult.secure_url,
        thumbnail_url: thumbnailUrl || undefined,
        media_key: `${keyNonce}:${encryptedKey}`, // Packed for storage
        media_key_nonce: keyNonce, 
        media_nonce: encodeBase64(nonce),
        type: file.type.startsWith('image/') ? 'image' : 
              file.type.startsWith('video/') ? 'video' : 
              file.type.startsWith('audio/') ? 'audio' : 'document',
        name: file.name,
        size: file.size,
      };

    } catch (error) {
      console.error('Media upload failed:', error);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const getDecryptedBlob = useCallback(async (
    url: string, 
    packedKey: string, 
    mediaNonce: string, 
    partnerPublicKey: string,
    senderPublicKey?: string | null,
    partnerKeyHistory?: string[]
  ): Promise<Blob | null> => {
    if (!user) return null;
    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return null;

    try {
      const [keyNonce, encryptedKey] = packedKey.split(':');
      if (!keyNonce || !encryptedKey) throw new Error('Invalid packed key');

      // NaCl box decryption: nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)
      // For a message I SENT:    "theirPublicKey" slot = Partner's public key (partnerPublicKey)
      // For a message I RECEIVED: "theirPublicKey" slot = partner's sender_public_key
      const isMine = senderPublicKey === encodeBase64(myKeyPair.publicKey);
      const primaryKey = isMine ? partnerPublicKey : (senderPublicKey || partnerPublicKey);
      
      // Try current partner key and all historical partner keys as fallbacks
      const fallbackKeys = (partnerKeyHistory || [])
        .filter(k => k !== primaryKey)
        .map(k => decodeBase64(k));

      const symmetricKey = decryptFileKeyWithFallback(
        encryptedKey, keyNonce, 
        decodeBase64(primaryKey), myKeyPair.secretKey,
        fallbackKeys
      );
      if (!symmetricKey) throw new Error('Failed to unwrap key');

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const ciphertext = new Uint8Array(arrayBuffer);

      const decrypted = decryptFile(ciphertext, symmetricKey, decodeBase64(mediaNonce));
      if (!decrypted) return null;

      return new Blob([decrypted as any]);
    } catch (error) {
      console.error('Decryption failed', error);
      return null;
    }
  }, [user]);

  return { processAndUpload, getDecryptedBlob, isProcessing, uploadProgress };
}
