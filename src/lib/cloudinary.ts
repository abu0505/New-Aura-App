import { routedUpload } from './cloudinaryRouter';

interface UploadOptions {
  onProgress?: (progress: number) => void;
  fileName?: string;
}

interface UploadResult {
  url: string;
  publicId: string;
  bytes: number;
}

/**
 * Upload an encrypted blob to Cloudinary as a raw file.
 * Uses the smart dual-account router — automatically switches between
 * Account A (del5o1vnd) and Account B (tvxm21ys) based on availability.
 */
export async function uploadToCloudinary(
  encryptedBlob: Blob,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { fileName } = options;
  const name = fileName || `encrypted_${Date.now()}.raw`;

  const result = await routedUpload({
    blob: new Blob([encryptedBlob as any]),
    fileName: name,
    resourceType: 'raw',
    onProgress: options.onProgress,
  });

  return {
    url: result.secureUrl,
    publicId: result.publicId,
    bytes: result.bytes,
  };
}

/**
 * Download an encrypted blob from Cloudinary.
 * Downloads work from any account URL — no routing needed.
 */
export async function downloadFromCloudinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download from Cloudinary: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

