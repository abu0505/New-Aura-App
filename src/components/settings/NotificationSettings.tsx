import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatSettings } from '../../hooks/useChatSettings';
import { checkPushSubscription, requestAndSubscribe, unsubscribeFromPushNotifications } from '../../lib/pushNotifications';

const DEFAULT_BODIES = [
  'Someone is thinking of you 💭',
  'A whisper has arrived for you 🤫',
  'Your sanctuary has a new message ✨',
  'Something special is waiting for you 💌',
  'A secret message has arrived 🔐',
  'You have been summoned to the sanctuary 🕯️',
  'A gentle knock on your heart 💛',
  'Love is calling you back 📱',
  'The universe sent you a signal 🌙',
  'Your world just got a little brighter ☀️',
];

const MIN_BODIES = 4;

export default function NotificationSettings() {
  const { user } = useAuth();
  const { settings, updateSettings } = useChatSettings();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // ── Status Message State ──
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  const statusTimeout = useRef<any>(null);

  const showStatus = (text: string, type: 'error' | 'success' = 'error') => {
    if (statusTimeout.current) clearTimeout(statusTimeout.current);
    setStatusMsg({ text, type });
    statusTimeout.current = setTimeout(() => setStatusMsg(null), 4000);
  };

  // ── Alias state ──
  const [aliasValue, setAliasValue] = useState('');
  const [editingAlias, setEditingAlias] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  // ── Bodies state ──
  const [bodies, setBodies] = useState<string[]>([]);
  const [newBody, setNewBody] = useState('');
  const [editingBodyIdx, setEditingBodyIdx] = useState<number | null>(null);
  const [editingBodyValue, setEditingBodyValue] = useState('');
  const [savingBodies, setSavingBodies] = useState(false);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [expandPersonalization, setExpandPersonalization] = useState(false);
  const newBodyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkPushSubscription().then(setPushEnabled);
  }, []);

  // Sync from settings
  useEffect(() => {
    if (!settings) return;
    setAliasValue(settings.notification_alias || '');
    setBodies(
      settings.notification_bodies?.length
        ? settings.notification_bodies
        : DEFAULT_BODIES
    );
  }, [settings?.notification_alias, settings?.notification_bodies]);

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
          showStatus('Signal permission denied by browser.', 'error');
        } else {
          showStatus('Failed to connect to signal.', 'error');
        }
      }
    } catch (_err) {
      // silent
    } finally {
      setIsTogglingPush(false);
    }
  };

  // ── Alias save ──
  const handleSaveAlias = async () => {
    if (!settings) return;
    setSavingAlias(true);
    setEditingAlias(false);
    await updateSettings({ notification_alias: aliasValue.trim() || null });
    setSavingAlias(false);
    showStatus('Signal name updated!', 'success');
  };

  // ── Bodies CRUD ──
  const saveBodies = async (newBodies: string[]) => {
    setSavingBodies(true);
    await updateSettings({ notification_bodies: newBodies });
    setSavingBodies(false);
  };

  const handleAddBody = async () => {
    const trimmed = newBody.trim();
    if (!trimmed) return;
    const updated = [...bodies, trimmed];
    setBodies(updated);
    setNewBody('');
    await saveBodies(updated);
    showStatus('Message added to pool!', 'success');
  };

  const handleDeleteBody = async (idx: number) => {
    if (bodies.length <= MIN_BODIES) {
      showStatus(`Abhi tum delete nahi kar sakte bcoz minimum notification body ${MIN_BODIES} honi chahiye. Nayi message add karo pehle isse hatane ke liye.`, 'error');
      return;
    }
    
    // Trigger animation
    setDeletingIdx(idx);
    
    // Wait for animation to finish (350ms)
    await new Promise(resolve => setTimeout(resolve, 350));
    
    const updated = bodies.filter((_, i) => i !== idx);
    setBodies(updated);
    await saveBodies(updated);
    setDeletingIdx(null);
    showStatus('Message removed.', 'success');
  };

  const startEditBody = (idx: number) => {
    setEditingBodyIdx(idx);
    setEditingBodyValue(bodies[idx]);
  };

  const handleSaveEditBody = async (idx: number) => {
    const trimmed = editingBodyValue.trim();
    if (!trimmed) { setEditingBodyIdx(null); return; }
    const updated = bodies.map((b, i) => i === idx ? trimmed : b);
    setBodies(updated);
    setEditingBodyIdx(null);
    await saveBodies(updated);
  };

  const handleResetBodies = async () => {
    setBodies(DEFAULT_BODIES);
    await saveBodies(DEFAULT_BODIES);
  };

  const currentAlias = settings?.notification_alias || '';
  const bodiesCount = bodies.length;


  return (
    <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl hover:border-[var(--gold)]/20 transition-all duration-500 group relative overflow-hidden">
      {/* ── Status Toast ── */}
      {statusMsg && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-[10px] uppercase tracking-widest font-bold z-50 animate-in fade-in zoom-in duration-300 ${
          statusMsg.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-[var(--gold)] text-black'
        }`}>
          {statusMsg.text}
        </div>
      )}

      {/* Decorative glow */}
      <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-[var(--gold)]/5 blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <span className="material-symbols-outlined text-[var(--gold)] group-hover:scale-110 transition-transform">notifications</span>
        <div>
          <h3 className="font-serif italic text-xl text-white">Sanctuary Signals</h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">Notification Management</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* ── Master Toggle ── */}
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

        {/* ── Granular Toggles REMOVED ── */}
        {pushEnabled && (
          <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-4 duration-500">
            {/* ── Personalization Expand Toggle ── */}
            <button
              onClick={() => setExpandPersonalization(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[var(--gold)]/5 border border-[var(--gold)]/10 hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/10 transition-all group/btn mt-2"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[var(--gold)] text-[18px]">tune</span>
                <div className="flex flex-col items-start">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--gold)] font-bold">Signal Personalization</span>
                  <span className="text-[9px] text-[var(--text-secondary)] italic">Custom name & rotating message bodies</span>
                </div>
              </div>
              <span className={`material-symbols-outlined text-[var(--gold)]/60 text-[16px] transition-transform duration-300 ${expandPersonalization ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {/* ── Personalization Panel ── */}
            {expandPersonalization && (
              <div className="space-y-6 pt-1 pb-2 animate-in fade-in slide-in-from-top-3 duration-400">

                {/* ── Notification Name (Alias) ── */}
                <div className="rounded-3xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-[var(--gold)] text-[16px]">badge</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)] font-bold">Your Signal Name</span>
                  </div>
                  <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed">
                    This name appears as the sender in push notifications. Leave blank to use your display name.
                  </p>

                  {editingAlias ? (
                    <div className="flex items-center gap-2">
                      <input
                        ref={aliasInputRef}
                        type="text"
                        value={aliasValue}
                        onChange={e => setAliasValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveAlias(); if (e.key === 'Escape') setEditingAlias(false); }}
                        maxLength={40}
                        placeholder="e.g. My Love, Hubby, Wifey..."
                        className="flex-1 bg-white/5 border border-[var(--gold)]/30 focus:border-[var(--gold)] focus:ring-0 shadow-none text-white text-sm rounded-2xl px-4 py-2.5 placeholder:text-white/20 transition-all"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveAlias}
                        className="w-10 h-10 rounded-2xl bg-[var(--gold)] text-black flex items-center justify-center hover:scale-105 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[16px]">check</span>
                      </button>
                      <button
                        onClick={() => { setEditingAlias(false); setAliasValue(settings?.notification_alias || ''); }}
                        className="w-10 h-10 rounded-2xl bg-white/5 text-white/40 flex items-center justify-center hover:bg-white/10 transition-all"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditingAlias(true); setTimeout(() => aliasInputRef.current?.focus(), 50); }}
                      className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white/5 border border-white/5 hover:border-[var(--gold)]/20 hover:bg-white/[0.07] cursor-pointer transition-all group/alias"
                    >
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[var(--text-secondary)] text-[16px]">person</span>
                        <span className={`text-sm ${currentAlias ? 'text-white' : 'text-white/30 italic'}`}>
                          {savingAlias ? (
                            <span className="flex items-center gap-2 text-[var(--gold)]">
                              <span className="material-symbols-outlined text-[14px] animate-spin">sync</span> Saving...
                            </span>
                          ) : currentAlias || 'Not set — tap to customize'}
                        </span>
                      </div>
                      <span className="material-symbols-outlined text-[var(--gold)]/40 group-hover/alias:text-[var(--gold)] text-[16px] transition-colors">edit</span>
                    </div>
                  )}
                </div>

                {/* ── Notification Bodies ── */}
                <div className="rounded-3xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[var(--gold)] text-[16px]">format_list_bulleted</span>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)] font-bold">Rotating Signal Bodies</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {savingBodies && (
                        <span className="material-symbols-outlined text-[var(--gold)] text-[14px] animate-spin">sync</span>
                      )}
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${bodiesCount >= MIN_BODIES ? 'bg-[var(--gold)]/10 text-[var(--gold)]' : 'bg-red-500/10 text-red-400'}`}>
                        {bodiesCount}/{MIN_BODIES} min
                      </span>
                    </div>
                  </div>
                  <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed">
                    One of these messages is randomly picked each time a notification is sent. Minimum {MIN_BODIES} messages required. You can delete only when count &gt; {MIN_BODIES}.
                  </p>

                  {/* Body list */}
                    <div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden custom-scrollbar pr-1">
                      {bodies.map((body, idx) => {
                        const isDeleting = deletingIdx === idx;
                        return (
                          <div
                            key={idx}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-white/[0.03] border transition-all duration-500 origin-top overflow-hidden ${
                              editingBodyIdx === idx ? 'border-[var(--gold)]/40' : 'border-white/5'
                            } ${
                              isDeleting 
                                ? 'opacity-0 max-h-0 py-0 my-0 border-none scale-95 translate-x-4' 
                                : 'opacity-100 max-h-20 translate-x-0'
                            }`}
                          >
                            {/* Index badge */}
                            <span className="text-[9px] font-mono text-[var(--gold)]/40 w-5 shrink-0 text-center">{idx + 1}</span>

                        {editingBodyIdx === idx ? (
                          <>
                            <input
                              type="text"
                              value={editingBodyValue}
                              onChange={e => setEditingBodyValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveEditBody(idx); if (e.key === 'Escape') setEditingBodyIdx(null); }}
                              className="flex-1 bg-transparent border-[var(--gold)]/40 focus:ring-0 shadow-none text-white text-[11px] py-0.5"
                              autoFocus
                              maxLength={120}
                            />
                            <button onClick={() => handleSaveEditBody(idx)} className="text-[var(--gold)] hover:scale-110 transition-transform">
                              <span className="material-symbols-outlined text-[14px]">check</span>
                            </button>
                            <button onClick={() => setEditingBodyIdx(null)} className="text-white/30 hover:text-white/60 transition-colors">
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-[11px] text-white/70 leading-snug">{body}</span>
                            <button
                              onClick={() => startEditBody(idx)}
                              className="text-white/20 hover:text-[var(--gold)] transition-colors shrink-0"
                              title="Edit"
                            >
                              <span className="material-symbols-outlined text-[14px]">edit</span>
                            </button>
                            <button
                              onClick={() => handleDeleteBody(idx)}
                              disabled={deletingIdx !== null}
                              className={`transition-colors shrink-0 ${bodies.length > MIN_BODIES ? 'text-white/20 hover:text-red-400' : 'text-white/10 hover:text-red-400'}`}
                              title={bodies.length > MIN_BODIES ? 'Delete' : `Minimum ${MIN_BODIES} required`}
                            >
                              <span className="material-symbols-outlined text-[14px]">delete</span>
                            </button>
                          </>
                        )}
                          </div>
                        );
                      })}
                    </div>

                  {/* Add new body */}
                  <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                    <input
                      ref={newBodyInputRef}
                      type="text"
                      value={newBody}
                      onChange={e => setNewBody(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddBody(); }}
                      placeholder="Add a new notification message..."
                      maxLength={120}
                      className="flex-1 bg-white/5 border border-white/5 focus:border-[var(--gold)] focus:ring-0 text-white text-[11px] rounded-full px-4 py-2.5 placeholder:text-white/20 transition-all shadow-none"
                    />
                    <button
                      onClick={handleAddBody}
                      disabled={!newBody.trim()}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                        newBody.trim() ? 'bg-[var(--gold)] text-black hover:scale-105 shadow-glow-sm' : 'bg-white/5 text-white/20 cursor-not-allowed'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                    </button>
                  </div>

                  {/* Reset to defaults */}
                  <button
                    onClick={handleResetBodies}
                    className="w-full mt-1 py-2 rounded-2xl text-[9px] uppercase tracking-widest text-[var(--text-secondary)] border border-white/5 hover:border-white/10 hover:text-white/60 transition-all flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                    Reset to Default Messages
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
