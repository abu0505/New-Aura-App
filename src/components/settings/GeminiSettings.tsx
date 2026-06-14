import { useState, useEffect } from 'react';
import { getGeminiStats, type GeminiStats } from '../../utils/gemini';

export default function GeminiSettings() {
  const [stats, setStats] = useState<GeminiStats>(getGeminiStats());

  useEffect(() => {
    // Update stats immediately on custom event
    const handleUpdate = () => {
      setStats(getGeminiStats());
    };

    window.addEventListener('aura-gemini-stats-updated', handleUpdate);

    // Refresh every 5 seconds to let RPM slide down as time passes
    const interval = setInterval(() => {
      setStats(getGeminiStats());
    }, 5000);

    return () => {
      window.removeEventListener('aura-gemini-stats-updated', handleUpdate);
      clearInterval(interval);
    };
  }, []);

  const handleReset = () => {
    localStorage.removeItem('aura_gemini_calls');
    setStats(getGeminiStats());
  };

  const rpmPercentage = Math.min((stats.rpm / stats.maxRpm) * 100, 100);
  const rpdPercentage = Math.min((stats.rpd / stats.maxRpd) * 100, 100);

  // Status determination
  let statusText = '🟢 API Healthy';
  let statusColor = 'text-emerald-400';
  let statusBg = 'bg-emerald-500/10 border-emerald-500/20';

  if (stats.rpm >= 12 || stats.rpd >= 1300) {
    statusText = '🔴 Quota Exhausted / Danger';
    statusColor = 'text-red-400';
    statusBg = 'bg-red-500/10 border-red-500/20';
  } else if (stats.rpm >= 8 || stats.rpd >= 1000) {
    statusText = '🟡 Near Limit Warning';
    statusColor = 'text-amber-400';
    statusBg = 'bg-amber-500/10 border-amber-500/20';
  }

  return (
    <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 border border-white/5 space-y-6 flex flex-col justify-between h-full">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-purple-400 text-2xl">network_ping</span>
            <div>
              <h3 className="text-white font-bold text-sm tracking-wider uppercase">Gemini AI Diagnostics</h3>
              <p className="text-[10px] text-white/40">Real-time Game Bot API Quota Tracker</p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full border text-[9px] uppercase font-bold tracking-wider ${statusColor} ${statusBg}`}>
            {statusText}
          </span>
        </div>

        <p className="text-xs text-white/60 leading-relaxed">
          Who Is The Spy game mein bots (Karan & Neha) ke responses Google Gemini API calls se aate hain. 
          Neeche diye gaye counters se aap RPM (limit: 15 per min) aur Daily limits check kar sakte hain.
        </p>

        {/* Meters */}
        <div className="space-y-4 pt-2">
          {/* RPM */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/70">Requests Per Minute (RPM)</span>
              <span className="font-mono text-white/90">{stats.rpm} / {stats.maxRpm}</span>
            </div>
            <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  stats.rpm >= 12 ? 'bg-gradient-to-r from-red-500 to-pink-500' :
                  stats.rpm >= 8 ? 'bg-gradient-to-r from-amber-500 to-orange-500' :
                  'bg-gradient-to-r from-emerald-500 to-teal-500'
                }`}
                style={{ width: `${rpmPercentage}%` }}
              />
            </div>
          </div>

          {/* RPD */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/70">Requests Today (RPD)</span>
              <span className="font-mono text-white/90">{stats.rpd} / {stats.maxRpd}</span>
            </div>
            <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  stats.rpd >= 1300 ? 'bg-gradient-to-r from-red-500 to-pink-500' :
                  stats.rpd >= 1000 ? 'bg-gradient-to-r from-amber-500 to-orange-500' :
                  'bg-gradient-to-r from-purple-500 to-indigo-500'
                }`}
                style={{ width: `${rpdPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 flex items-center justify-between border-t border-white/5 mt-auto">
        <span className="text-[10px] text-white/30 italic">
          *Limits set by Google AI Studio Developer Free Tier.
        </span>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-[10px] rounded-full border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-all font-bold uppercase tracking-wider flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-xs">restart_alt</span>
          Reset Stats
        </button>
      </div>
    </div>
  );
}
