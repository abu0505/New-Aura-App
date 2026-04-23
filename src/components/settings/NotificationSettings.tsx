import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatSettings } from '../../hooks/useChatSettings';
import { checkPushSubscription, requestAndSubscribe, unsubscribeFromPushNotifications } from '../../lib/pushNotifications';

export default function NotificationSettings() {
  const { user } = useAuth();
  const { settings, updateSettings } = useChatSettings();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  useEffect(() => {
    checkPushSubscription().then(setPushEnabled);
  }, []);

  const togglePush = async () => {
    if (!user || isTogglingPush) return;
    setIsTogglingPush(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPushNotifications(user.id);
        setPushEnabled(false);
      } else {
        const result = await requestAndSubscribe(user.id);
        if (result === 'granted') {
          setPushEnabled(true);
        } else if (result === 'denied') {
          alert('Communication permission denied. To enable, update your site settings in the browser.');
        } else {
          alert('Failed to connect to the Sanctuary signal.');
        }
      }
    } catch (err) {
      
    } finally {
      setIsTogglingPush(false);
    }
  };

  const toggleCategory = async (key: 'notify_messages' | 'notify_reactions' | 'notify_streaks') => {
    if (!settings) return;
    await updateSettings({ [key]: !settings[key] });
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl hover:border-[var(--gold)]/20 transition-all duration-500 group relative overflow-hidden">
      <div className="flex items-center gap-4 mb-8">
        <span className="material-symbols-outlined text-[var(--gold)] group-hover:scale-110 transition-transform">notifications</span>
        <div>
          <h3 className="font-serif italic text-xl text-white">Sanctuary Signals</h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">Notification Management</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Master Toggle */}
        <div 
          onClick={togglePush}
          className={`flex justify-between items-center p-4 rounded-3xl cursor-pointer transition-all border ${
            pushEnabled ? 'bg-[var(--gold)]/5 border-[var(--gold)]/20' : 'bg-white/5 border-transparent opacity-60'
          } ${isTogglingPush ? 'animate-pulse' : ''}`}
        >
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.2em] text-white font-bold">Signal Reception</span>
            <span className="text-[9px] text-[var(--text-secondary)] italic">Allow the sanctuary to reach you</span>
          </div>
          <div className={`w-12 h-6 rounded-full relative transition-all duration-500 ${pushEnabled ? 'bg-[var(--gold)]' : 'bg-black/40'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-500 ${pushEnabled ? 'right-1 bg-black shadow-glow' : 'left-1 bg-white/20'}`} />
          </div>
        </div>

        {/* Granular Toggles (Only if master push is on) */}
        {pushEnabled && (
          <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-4 duration-500">
            {[
              { id: 'notify_messages', label: 'Whispers & Echoes', desc: 'New messages and media', icon: 'chat' },
              { id: 'notify_reactions', label: 'Resonances', desc: 'Reactions and heartbeat taps', icon: 'favorite' },
              { id: 'notify_streaks', label: 'Flame Continuity', desc: 'Streak updates and reminders', icon: 'local_fire_department' },
            ].map((item) => {
              const isActive = settings ? settings[item.id as keyof typeof settings] : false;
              return (
                <div 
                  key={item.id}
                  onClick={() => toggleCategory(item.id as any)}
                  className="flex justify-between items-center px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 cursor-pointer hover:bg-white/[0.06] transition-all"
                >
                  <div className="flex items-center gap-4">
                    <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/40'}`}>
                      {item.icon}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-widest text-[var(--gold)] font-bold">
                        {item.label}
                      </span>
                      <span className="text-[9px] text-[var(--text-secondary)] leading-none mt-1">{item.desc}</span>
                    </div>
                  </div>
                  <div className={`w-8 h-4 rounded-full relative transition-all ${isActive ? 'bg-[var(--gold)]/40' : 'bg-white/5'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${isActive ? 'right-0.5 bg-[var(--gold)]' : 'left-0.5 bg-white/20'}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
