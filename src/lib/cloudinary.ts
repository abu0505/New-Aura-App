const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

if (!CLOUD_NAME || !UPLOAD_PRESET) {
  
}

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
 * Since all uploads are encrypted binary, we always use resource_type: "raw".
 */
export async function uploadToCloudinary(
  encryptedBlob: Blob,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { fileName } = options;

  const formData = new FormData();
  const name = fileName || `encrypted_${Date.now()}.raw`;
  
  // Create a clean Blob exactly like useMedia.ts does
  formData.append('file', new Blob([encryptedBlob as any]), name);
  formData.append('upload_preset', UPLOAD_PRESET);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errText = await response.text();
      
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      url: data.secure_url,
      publicId: data.public_id,
      bytes: data.bytes,
    };
  } catch (error: any) {
    throw new Error('Network error during upload: ' + error.message);
  }
}

/**
 * Download an encrypted blob from Cloudinary.
 */
export async function downloadFromCloudinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download from Cloudinary: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
