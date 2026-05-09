import type { ChatSettings } from '../types';

export const getBackgroundData = (settings: ChatSettings | null | undefined, isDesktop: boolean) => {
  if (!settings || !settings.background_url) return null;

  try {
    if (settings.background_url.startsWith('{')) {
      const urls = JSON.parse(settings.background_url);
      const keys = settings.background_key ? JSON.parse(settings.background_key) : {};
      const nonces = settings.background_nonce ? JSON.parse(settings.background_nonce) : {};

      if (isDesktop && urls.desktop) {
        return {
          url: urls.desktop,
          key: keys.desktop ? JSON.stringify(keys.desktop) : null,
          nonce: nonces.desktop ? JSON.stringify(nonces.desktop) : null,
        };
      }
      if (!isDesktop && urls.mobile) {
         return {
          url: urls.mobile,
          key: keys.mobile ? JSON.stringify(keys.mobile) : null,
          nonce: nonces.mobile ? JSON.stringify(nonces.mobile) : null,
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
