const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
const FOLDER = import.meta.env.VITE_CLOUDINARY_FOLDER || 'hamare_private_stuff';

if (!CLOUD_NAME || !UPLOAD_PRESET) {
  console.error('Missing Cloudinary environment variables');
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
  const { onProgress, fileName } = options;

  const formData = new FormData();
  const name = fileName || `encrypted_${Date.now()}.bin`;
  
  formData.append('file', encryptedBlob, name);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', FOLDER);
  formData.append('resource_type', 'raw');

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);

    // Progress tracking
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve({
            url: response.secure_url,
            publicId: response.public_id,
            bytes: response.bytes,
          });
        } catch {
          reject(new Error('Failed to parse Cloudinary response'));
        }
      } else {
        reject(new Error(`Cloudinary upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during Cloudinary upload'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Cloudinary upload timed out'));
    };

    // 5 minute timeout for large files
    xhr.timeout = 300000;
    xhr.send(formData);
  });
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
