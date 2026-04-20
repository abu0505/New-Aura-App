import { useChatSettings } from '../../hooks/useChatSettings';
import QuickEmojiSettings from './QuickEmojiSettings';

const COLORS = [
  { id: 'gold', hex: '#e6c487', label: 'Sanctuary Gold' },
  { id: 'emerald', hex: '#6ECB8A', label: 'Emerald' },
  { id: 'sapphire', hex: '#7C9AF2', label: 'Sapphire Blue' },
  { id: 'rose', hex: '#D4A0A0', label: 'Rose' },
  { id: 'purple', hex: '#C084FC', label: 'Neon Purple' },
  { id: 'sky', hex: '#38BDF8', label: 'Sky Blue' },
];

export default function AppearanceSettings() {
  const { settings, updateSettings } = useChatSettings();

  const currentAccent = settings?.accent_color || '#e6c487';
  const isTrueDark = settings?.true_dark_mode || false;

  const handleColorSelect = async (hex: string) => {
    if (!settings) return;
    await updateSettings({ accent_color: hex });
  };

  const toggleTrueDark = async () => {
    if (!settings) return;
    await updateSettings({ true_dark_mode: !isTrueDark });
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-[2.5rem] p-10 shadow-2xl hover:border-[var(--gold)]/20 transition-all duration-500 group relative overflow-hidden">
      <div className="flex items-center gap-4 mb-8">
        <span className="material-symbols-outlined text-[var(--gold)] group-hover:scale-110 transition-transform">palette</span>
        <div>
          <h3 className="font-serif italic text-xl text-white">Appearance</h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-white/50">Theme & Ambience</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Accent Colors */}
        <div>
          <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold block mb-4">Aura Signature</span>
          <div className="grid grid-cols-6 gap-2">
            {COLORS.map((color) => {
              const isSelected = currentAccent.toLowerCase() === color.hex.toLowerCase();
              return (
                <button
                  key={color.id}
                  onClick={() => handleColorSelect(color.hex)}
                  className={`w-8 h-8 md:w-10 md:h-10 rounded-full cursor-pointer relative transition-all mx-auto flex items-center justify-center ${
                    isSelected ? 'scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
                  }`}
                  style={{ 
                    backgroundColor: color.hex,
                    boxShadow: isSelected ? `0 0 15px ${color.hex}66` : 'none',
                    border: isSelected ? `2px solid white` : '2px solid transparent'
                  }}
                  title={color.label}
                >
                  {isSelected && (
                    <span className="material-symbols-outlined text-black text-[16px] font-bold">check</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* True Dark Mode Toggle */}
        <div 
          onClick={toggleTrueDark}
          className={`flex justify-between items-center p-4 rounded-3xl cursor-pointer transition-all border ${
            isTrueDark ? 'bg-[var(--gold)]/5 border-[var(--gold)]/20' : 'bg-white/5 border-transparent opacity-60 hover:opacity-80'
          }`}
        >
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold">Absolute Black</span>
            <span className="text-[9px] text-[var(--gold)] italic">OLED-optimized true dark mode</span>
          </div>
          <div className={`w-12 h-6 rounded-full relative transition-all duration-500 ${isTrueDark ? 'bg-[var(--gold)]' : 'bg-black/40'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-500 ${isTrueDark ? 'right-1 bg-black shadow-glow' : 'left-1 bg-white/20'}`} />
          </div>
        </div>

        {/* Quick Emojis customization */}
        <div className="pt-4 border-t border-white/5">
          <QuickEmojiSettings />
        </div>
      </div>
    </div>
  );
}
