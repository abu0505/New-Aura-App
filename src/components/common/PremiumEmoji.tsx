import { useState, useEffect, useRef } from 'react';
import { Emoji, EmojiStyle } from 'emoji-picker-react';
import emojiDict from 'unicode-emoji-json/data-by-emoji.json';
interface PremiumEmojiProps {
  emoji: string;
  size?: number;
  className?: string;
}

/**
 * Renders a high-quality emoji using the Apple style (consistent across platforms).
 * Use this to maintain "premiumness" instead of relying on system-native emojis.
 */
export default function PremiumEmoji({ emoji, size = 20, className = "" }: PremiumEmojiProps) {
  // If no emoji provided, return null
  if (!emoji) return null;

  return (
    <div className={`inline-flex items-center justify-center select-none pointer-events-none ${className}`}>
      <Emoji 
        unified={emojiToUnified(emoji)} 
        size={size} 
        emojiStyle={EmojiStyle.APPLE}
        lazyLoad={true}
      />
    </div>
  );
}

/**
 * Converts a raw emoji character to its unified unicode hex string.
 * emoji-picker-react's <Emoji /> works best with the 'unified' prop.
 */
export function emojiToUnified(emoji: string): string {
  // If it's already a unified hex (sometimes stored that way), return it
  if (/^[0-9a-fA-F-]+$/.test(emoji)) return emoji;

  const codes = [];
  for (const char of emoji) {
    const code = char.codePointAt(0);
    if (code) {
      codes.push(code.toString(16).toLowerCase());
    }
  }
  
  // Handle complex emojis (like skin tones, genders, sequences)
  // Join with hyphen as standard unified format
  // Note: some zero-width joiners (fe0f) are sometimes dropped in Google's URL,
  // but usually fonts.gstatic handles standard unified codes. We strip fe0f if it's there
  // for better compatibility with Noto's CDN which often omits it.
  return codes.filter(c => c !== 'fe0f').join('-');
}

const TARIKUL_CATEGORIES = [
  'Smileys',
  'People',
  'Animals and Nature',
  'Food and Drink',
  'Activity',
  'Travel and Places',
  'Objects',
  'Symbols',
  'Flags'
];

const EMOJI_CATEGORY_OVERRIDES: Record<string, string> = {
  '🔥': 'Animals and Nature',
  '❤️': 'Symbols',
  '✨': 'Smileys',
  '🎉': 'Activity',
  '👍': 'People',
  '👎': 'People',
  '👏': 'People',
  '🙌': 'People',
  '🙏': 'People',
  '💪': 'People',
  '💥': 'Smileys',
  '💯': 'Symbols',
  '💔': 'Smileys',
  '💕': 'Smileys',
  '💖': 'Smileys',
  '💗': 'Smileys',
  '💘': 'Smileys',
  '💙': 'Symbols',
  '💚': 'Symbols',
  '💛': 'Symbols',
  '💜': 'Symbols',
  '🖤': 'Symbols',
  '🤍': 'Symbols',
  '🤎': 'Symbols',
  '🧡': 'Symbols',
};

function getPrimaryCategory(group: string): string {
  switch (group) {
    case 'Smileys & Emotion': return 'Smileys';
    case 'People & Body': return 'People';
    case 'Animals & Nature': return 'Animals and Nature';
    case 'Food & Drink': return 'Food and Drink';
    case 'Travel & Places': return 'Travel and Places';
    case 'Activities': return 'Activity';
    case 'Objects': return 'Objects';
    case 'Symbols': return 'Symbols';
    case 'Flags': return 'Flags';
    default: return 'Smileys';
  }
}

function cleanEmojiName(name: string): string {
  let cleaned = name.replace(/-/g, ' ');
  const minorWords = ['of', 'in', 'on', 'at', 'to', 'for', 'by', 'a', 'an', 'the', 'and', 'or', 'but'];
  return cleaned
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && minorWords.includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanEmojiNameAllCapital(name: string): string {
  let cleaned = name.replace(/-/g, ' ');
  return cleaned
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function getTelegramEmojiUrls(emoji: string): string[] {
  // @ts-ignore
  let entry = emojiDict[emoji];
  if (!entry) {
    const cleanEmoji = emoji.replace('\uFE0F', '');
    // @ts-ignore
    entry = emojiDict[cleanEmoji];
  }

  if (!entry) return [];

  const name1 = cleanEmojiName(entry.name);
  const name2 = cleanEmojiNameAllCapital(entry.name);
  const fileNames = Array.from(new Set([name1, name2]));

  const cleanEmojiKey = emoji.replace('\uFE0F', '');
  const primaryCategory = EMOJI_CATEGORY_OVERRIDES[emoji] || EMOJI_CATEGORY_OVERRIDES[cleanEmojiKey] || getPrimaryCategory(entry.group);
  const otherCategories = TARIKUL_CATEGORIES.filter(cat => cat !== primaryCategory);
  const orderedCategories = [primaryCategory, ...otherCategories];

  const urls: string[] = [];
  for (const cat of orderedCategories) {
    for (const fileName of fileNames) {
      urls.push(`https://raw.githubusercontent.com/Tarikul-Islam-Anik/Telegram-Animated-Emojis/main/${encodeURIComponent(cat)}/${encodeURIComponent(fileName)}.webp`);
    }
  }

  return urls;
}

/**
 * A component that takes a string of text and renders it with high-quality emojis.
 */
export function EmojiText({ text, size = 18, className = "" }: { text: string; size?: number; className?: string }) {
  if (!text) return null;

  // Generic emoji regex using Unicode property escapes
  // Supports basic emojis, sequences, skin tones, etc.
  const emojiPattern = "(\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?)";
  const splitRegex = new RegExp(emojiPattern, 'gu');
  const testRegex = new RegExp(`^${emojiPattern}$`, 'u');
  
  const parts = text.split(splitRegex);
  
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part && testRegex.test(part)) {
          // Re-test with a state-less regex to be sure it's an emoji match 
          // (split with capture group keeps the dividers)
          return (
            <span key={i}>
              <PremiumEmoji emoji={part} size={size} className="mx-[0.05em] align-[-0.2em]" />
              <wbr />
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

/**
 * Checks if a message consists entirely of 1 to 3 emojis.
 */
export function isEmojiOnlyMessage(text: string): { isEmojiOnly: boolean, emojis: string[] } {
  if (!text) return { isEmojiOnly: false, emojis: [] };
  
  const emojiPattern = "(\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?)";
  const splitRegex = new RegExp(emojiPattern, 'gu');
  const testRegex = new RegExp(`^${emojiPattern}$`, 'u');
  
  const parts = text.split(splitRegex);
  const emojis: string[] = [];
  
  for (const part of parts) {
    if (!part) continue;
    if (part.trim() === '') continue; // ignore whitespace
    
    if (testRegex.test(part)) {
      emojis.push(part);
    } else {
      // If any non-whitespace, non-emoji text exists, it's not an emoji-only message
      return { isEmojiOnly: false, emojis: [] };
    }
  }
  
  const isEmojiOnly = emojis.length > 0 && emojis.length <= 3;
  return { isEmojiOnly, emojis: isEmojiOnly ? emojis : [] };
}

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
  className?: string;
  messageId?: string;
}

const EMOJI_FORCE_FALLBACK = ['🥰', '😍'];

export function AnimatedEmoji({ emoji, size = 120, className = "", messageId }: AnimatedEmojiProps) {
  const [telegramUrlIndex, setTelegramUrlIndex] = useState(0);
  const [useFallback, setUseFallback] = useState(false);
  const [hasError, setHasError] = useState(false);
  
  // Custom states for 2-loop logic & click replay
  const [isStatic, setIsStatic] = useState(false);
  const [staticDataUrl, setStaticDataUrl] = useState<string | null>(null);
  const [cacheBuster, setCacheBuster] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Start initial 2-loop timer (approx 4.5 seconds)
    setIsStatic(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    
    timerRef.current = setTimeout(() => {
      setIsStatic(true);
    }, 4500); // ~2 loops of ~2.2s each

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [emoji, cacheBuster]);

  // Listen to realtime click events for this specific message
  useEffect(() => {
    if (!messageId) return;

    const handleEmojiClick = () => {
      setIsStatic(false);
      setCacheBuster(Date.now()); // Forces image reload to replay animation
      
      if (timerRef.current) clearTimeout(timerRef.current);
      // Click replay animates exactly 1 time (~2.2 seconds)
      timerRef.current = setTimeout(() => {
        setIsStatic(true);
      }, 2200);
    };

    window.addEventListener(`emoji_click_${messageId}`, handleEmojiClick);
    return () => {
      window.removeEventListener(`emoji_click_${messageId}`, handleEmojiClick);
    };
  }, [messageId]);

  const handleClick = () => {
    if (messageId && (window as any).triggerEmojiClick) {
      (window as any).triggerEmojiClick(messageId);
    }
  };

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    try {
      // Capture the first frame of the high-res WebP onto canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || size * 2;
      canvas.height = img.naturalHeight || size * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setStaticDataUrl(canvas.toDataURL('image/png'));
      }
    } catch (err) {
      console.warn('CORS or Canvas issue capturing static frame, falling back to static emoji', err);
    }
  };

  if (!emoji) return null;
  
  // Check if emoji is blacklisted from Telegram CDN (e.g. 🥰 and 😍 to fix the bug)
  const isForceFallback = EMOJI_FORCE_FALLBACK.includes(emoji) || EMOJI_FORCE_FALLBACK.includes(emoji.replace('\uFE0F', ''));

  if (hasError) {
    return <PremiumEmoji emoji={emoji} size={size / 2} className={className} />;
  }

  // Render the high-resolution captured static frame when animation finishes
  if (isStatic && staticDataUrl) {
    return (
      <img
        src={staticDataUrl}
        alt={emoji}
        onClick={handleClick}
        style={{ width: size, height: size }}
        className={`select-none object-contain cursor-pointer active:scale-95 transition-transform duration-100 ${className}`}
        draggable={false}
      />
    );
  }

  // Fallback to static Apple emoji if canvas capture is not ready yet
  if (isStatic) {
    return (
      <div onClick={handleClick} className="cursor-pointer active:scale-95 transition-transform duration-100">
        <PremiumEmoji emoji={emoji} size={size} className={className} />
      </div>
    );
  }
  
  const unified = emojiToUnified(emoji);
  const fallbackUrl = `https://fonts.gstatic.com/s/e/notoemoji/latest/${unified}/512.webp`;

  const telegramUrls = isForceFallback ? [] : getTelegramEmojiUrls(emoji);
  const showTelegram = telegramUrls.length > 0 && !useFallback && telegramUrlIndex < telegramUrls.length;
  
  const rawUrl = showTelegram ? telegramUrls[telegramUrlIndex] : fallbackUrl;
  const currentUrl = rawUrl ? `${rawUrl}?cb=${cacheBuster}` : '';

  const handleError = () => {
    if (showTelegram) {
      if (telegramUrlIndex < telegramUrls.length - 1) {
        setTelegramUrlIndex(prev => prev + 1);
      } else {
        setUseFallback(true);
      }
    } else {
      setHasError(true);
    }
  };

  return (
    <img 
      src={currentUrl} 
      alt={emoji}
      crossOrigin="anonymous"
      onLoad={handleLoad}
      onError={handleError}
      onClick={handleClick}
      style={{ width: size, height: size }}
      className={`select-none object-contain cursor-pointer active:scale-95 transition-transform duration-100 ${className}`}
      draggable={false}
    />
  );
}
