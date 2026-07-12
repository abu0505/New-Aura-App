/**
 * cloudinaryRouter.ts — Smart dual-account Cloudinary upload router.
 *
 * Strategy:
 *   - Try the "preferred" account (stored in localStorage).
 *   - If upload fails → automatically fallback to the other account.
 *   - On fallback success → update localStorage so next uploads skip the failed account.
 *   - Every 24 hours → retry the previously-failed account (in case credits reset).
 *
 * Account A: del5o1vnd  (original)
 * Account B: tvxm21ys   (backup)
 */

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cloudinary_preferred_account';
const FAILED_AT_KEY = 'cloudinary_failed_at';
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CloudinaryAccount {
  cloudName: string;
  uploadPreset: string;
  label: 'A' | 'B';
}

const ACCOUNT_A: CloudinaryAccount = {
  cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME_A || 'del5o1vnd',
  uploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_A || 'hamara-encrypted-media',
  label: 'A',
};

const ACCOUNT_B: CloudinaryAccount = {
  cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME_B || 'tvxm21ys',
  uploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_B || 'hamara-encrypted-media',
  label: 'B',
};

// ── Account Selection Logic ───────────────────────────────────────────────

/**
 * Returns the account that should be tried FIRST for the next upload.
 * - Checks if the failed account's 24h cooldown has passed (auto-recovery).
 * - Falls back to Account B if Account A has been failing recently.
 */
export function getPreferredAccount(): CloudinaryAccount {
  try {
    const preferred = localStorage.getItem(STORAGE_KEY) as 'A' | 'B' | null;
    const failedAt = localStorage.getItem(FAILED_AT_KEY);

    // If Account A was failing, check if 24h has passed for auto-recovery
    if (preferred === 'B' && failedAt) {
      const elapsed = Date.now() - parseInt(failedAt, 10);
      if (elapsed >= RETRY_INTERVAL_MS) {
        // 24h passed — try Account A again as primary
        console.log('[CloudinaryRouter] 24h passed — retrying Account A as primary');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(FAILED_AT_KEY);
        return ACCOUNT_A;
      }
    }

    if (preferred === 'B') return ACCOUNT_B;
    return ACCOUNT_A; // Default: Account A
  } catch {
    return ACCOUNT_A;
  }
}

/**
 * Returns the fallback account (the one that is NOT currently preferred).
 */
function getFallbackAccount(preferred: CloudinaryAccount): CloudinaryAccount {
  return preferred.label === 'A' ? ACCOUNT_B : ACCOUNT_A;
}

/**
 * Mark an account as failed → next uploads will skip it.
 */
function markAccountFailed(account: CloudinaryAccount): void {
  try {
    const fallback = getFallbackAccount(account);
    localStorage.setItem(STORAGE_KEY, fallback.label);
    localStorage.setItem(FAILED_AT_KEY, Date.now().toString());
    console.warn(`[CloudinaryRouter] Account ${account.label} (${account.cloudName}) failed → switching to Account ${fallback.label}`);
  } catch { /* ignore */ }
}

/**
 * Mark an account as working → ensure it stays preferred.
 */
function markAccountWorking(account: CloudinaryAccount): void {
  try {
    localStorage.setItem(STORAGE_KEY, account.label);
    // Clear the failed timestamp if this account was previously failing
    if (account.label !== 'B') {
      localStorage.removeItem(FAILED_AT_KEY);
    }
  } catch { /* ignore */ }
}

// ── Error Detection ───────────────────────────────────────────────────────

/**
 * Determine if an HTTP error from Cloudinary means "account limit reached".
 * Cloudinary returns 400 with "Account is temporarily blocked" or similar
 * messages when bandwidth/credit limit is hit.
 */
function isLimitError(status: number, body: string): boolean {
  if (status === 400 || status === 401 || status === 403 || status === 429) {
    const lower = body.toLowerCase();
    return (
      lower.includes('limit') ||
      lower.includes('blocked') ||
      lower.includes('credit') ||
      lower.includes('exceeded') ||
      lower.includes('bandwidth') ||
      lower.includes('quota') ||
      lower.includes('disabled')
    );
  }
  return false;
}

// ── Core Upload Function ──────────────────────────────────────────────────

interface RouterUploadOptions {
  blob: Blob;
  fileName: string;
  resourceType: 'raw' | 'image';
  onProgress?: (progress: number) => void;
}

interface RouterUploadResult {
  secureUrl: string;
  publicId: string;
  bytes: number;
  accountUsed: 'A' | 'B';
}

/**
 * Upload a blob to Cloudinary using the smart dual-account router.
 *
 * - Tries the preferred account first.
 * - On limit/error → automatically retries with the other account.
 * - Updates localStorage so future uploads use the working account.
 */
export async function routedUpload(options: RouterUploadOptions): Promise<RouterUploadResult> {
  const { blob, fileName, resourceType } = options;

  const preferred = getPreferredAccount();
  const fallback = getFallbackAccount(preferred);

  // ── Try preferred account ─────────────────────────────────────────────
  try {
    const result = await uploadToAccount(preferred, blob, fileName, resourceType);
    markAccountWorking(preferred);
    console.log(`[CloudinaryRouter] ✅ Upload success via Account ${preferred.label}`);
    return { ...result, accountUsed: preferred.label };
  } catch (err: any) {
    const isLimit = err?.isLimitError === true;
    console.warn(`[CloudinaryRouter] Account ${preferred.label} failed (limit=${isLimit}):`, err?.message);

    if (isLimit) {
      markAccountFailed(preferred);
    }
    // For ANY error on preferred → try fallback (could be network, limit, etc.)
  }

  // ── Try fallback account ──────────────────────────────────────────────
  try {
    const result = await uploadToAccount(fallback, blob, fileName, resourceType);
    markAccountWorking(fallback);
    // Also mark preferred as failed so next upload uses fallback directly
    markAccountFailed(preferred);
    console.log(`[CloudinaryRouter] ✅ Upload success via fallback Account ${fallback.label}`);
    return { ...result, accountUsed: fallback.label };
  } catch (err: any) {
    throw new Error(
      `[CloudinaryRouter] Both accounts failed. ` +
      `A: ${preferred.label}, B: ${fallback.label}. Last error: ${err?.message}`
    );
  }
}

// ── Internal: Single-account upload ──────────────────────────────────────

async function uploadToAccount(
  account: CloudinaryAccount,
  blob: Blob,
  fileName: string,
  resourceType: 'raw' | 'image',
): Promise<{ secureUrl: string; publicId: string; bytes: number }> {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('upload_preset', account.uploadPreset);

  const url = `https://api.cloudinary.com/v1_1/${account.cloudName}/${resourceType}/upload`;

  const response = await fetch(url, { method: 'POST', body: formData });

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }

    const limitErr = isLimitError(response.status, body);
    const err: any = new Error(`Cloudinary Account ${account.label} upload failed (${response.status}): ${body}`);
    err.isLimitError = limitErr;
    throw err;
  }

  const data = await response.json();
  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    bytes: data.bytes ?? 0,
  };
}

// ── Utility: Get current account status (for Settings display) ────────────

export function getCloudinaryStatus(): {
  preferred: 'A' | 'B';
  accountA: CloudinaryAccount;
  accountB: CloudinaryAccount;
  failedAt: number | null;
  autoRecoveryAt: string | null;
} {
  let preferred: 'A' | 'B' = 'A';
  let failedAt: number | null = null;
  let autoRecoveryAt: string | null = null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'B') preferred = 'B';

    const failedAtStr = localStorage.getItem(FAILED_AT_KEY);
    if (failedAtStr) {
      failedAt = parseInt(failedAtStr, 10);
      const recoveryTime = new Date(failedAt + RETRY_INTERVAL_MS);
      autoRecoveryAt = recoveryTime.toLocaleString();
    }
  } catch { /* ignore */ }

  return { preferred, accountA: ACCOUNT_A, accountB: ACCOUNT_B, failedAt, autoRecoveryAt };
}

/**
 * Manually force-switch to a specific account (for Settings UI).
 */
export function forceAccount(label: 'A' | 'B'): void {
  try {
    localStorage.setItem(STORAGE_KEY, label);
    localStorage.removeItem(FAILED_AT_KEY);
    console.log(`[CloudinaryRouter] Manually switched to Account ${label}`);
  } catch { /* ignore */ }
}
