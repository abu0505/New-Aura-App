import type { ChatSettings } from '../types';

export const getBackgroundData = (settings: ChatSettings | null | undefined, isDesktop: boolean) => {
  if (!settings || !settings.background_url) return null;

  try {
    if (settings.background_url.startsWith('{')) {
      const urls = JSON.parse(settings.background_url);
      const keys = settings.background_key ? JSON.parse(settings.background_key) : {};
      const nonces = settings.background_nonce ? JSON.parse(settings.background_nonce) : {};

      const primaryType = isDesktop ? 'desktop' : 'mobile';
      const fallbackType = isDesktop ? 'mobile' : 'desktop';

      if (urls[primaryType]) {
        return {
          url: urls[primaryType],
          key: keys[primaryType] ? JSON.stringify(keys[primaryType]) : null,
          nonce: nonces[primaryType] ? JSON.stringify(nonces[primaryType]) : null,
        };
      } else if (urls[fallbackType]) {
        return {
          url: urls[fallbackType],
          key: keys[fallbackType] ? JSON.stringify(keys[fallbackType]) : null,
          nonce: nonces[fallbackType] ? JSON.stringify(nonces[fallbackType]) : null,
        };
      }
    }
  } catch (e) {
    console.error("Failed to parse multi-background format", e);
  }

  return {
    url: settings.background_url,
    key: settings.background_key,
    nonce: settings.background_nonce,
  };
};
