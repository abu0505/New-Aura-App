import { Emoji, EmojiStyle } from 'emoji-picker-react';

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
function emojiToUnified(emoji: string): string {
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
  return codes.join('-');
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
          return <PremiumEmoji key={i} emoji={part} size={size} className="mx-[0.05em] align-[-0.2em]" />;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
