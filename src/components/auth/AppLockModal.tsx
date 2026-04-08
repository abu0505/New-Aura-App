import React, { useState } from 'react';
import { useAppLock } from '../../contexts/AppLockContext';

interface AppLockModalProps {
  onCancel: () => void;
}

export default function AppLockModal({ onCancel }: AppLockModalProps) {
  const { isLocked, unlockApp } = useAppLock();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLocked) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) {
      setError('PIN must be at least 4 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const success = await unlockApp(pin);
      if (!success) {
        setError('Incorrect PIN. Sanctuary remains locked.');
        setPin(''); // clear pin on failure
      }
    } catch (err) {
      setError('System error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-2xl p-6 transition-all duration-500">
      <div className="w-full max-w-md bg-[var(--bg-secondary)] border border-[rgba(var(--primary-rgb),_0.1)] rounded-3xl p-8 shadow-[0_0_50px_rgba(var(--primary-rgb),0.05)] relative overflow-hidden group">
        
        {/* Aesthetic Background Elements */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-[rgba(var(--primary-rgb),_0.05)] blur-[120px] rounded-full" />
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-red-900/10 blur-[120px] rounded-full" />

        <div className="flex flex-col items-center text-center space-y-8 relative z-10">
          <div className="w-20 h-20 bg-[rgba(var(--primary-rgb),_0.05)] rounded-full flex items-center justify-center border border-[rgba(var(--primary-rgb),_0.2)] shadow-[0_0_30px_rgba(var(--primary-rgb),0.1)]">
            <span className="material-symbols-outlined text-4xl text-[var(--gold)] animate-pulse">
              lock
            </span>
          </div>

          <div className="space-y-3 lg:px-4">
            <h2 className="font-serif italic text-3xl text-[var(--gold)] tracking-wide">
              Sanctuary Locked
            </h2>
            <p className="text-xs text-[#998f81]/70 leading-relaxed font-label uppercase tracking-widest">
              Enter the shared PIN to access your private connection.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-6">
            <div className="relative">
              <input
                type="password"
                value={pin}
                onChange={(e) => {
                   setPin(e.target.value);
                   setError(null);
                }}
                placeholder="ENTER PIN"
                className="w-full bg-transparent border border-[var(--gold)]/20 rounded-2xl px-6 py-5 text-center text-3xl tracking-[0.5em] text-[#e4e1ed] focus:outline-none focus:border-[var(--gold)] focus:bg-white/[0.02] transition-all placeholder:text-[10px] placeholder:tracking-[0.3em] placeholder:uppercase placeholder:text-[#998f81]/30"
                maxLength={10} // Just in case they want a longer pin
                disabled={loading}
                autoFocus
              />
              {error && (
                <div className="absolute -bottom-8 left-0 right-0 text-center">
                  <p className="text-[10px] text-red-400/90 uppercase tracking-[0.2em] font-bold">
                    {error}
                  </p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-light)] text-[var(--bg-primary)] font-bold py-4 rounded-2xl shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.25)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:hover:scale-100 flex items-center justify-center gap-2 mt-4"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-[var(--bg-primary)]/30 border-t-[var(--bg-primary)] rounded-full animate-spin" />
              ) : (
                <span className="uppercase tracking-[0.2em] text-[11px]">
                  Unlock App
                </span>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] uppercase tracking-widest text-[#998f81]/50 hover:text-[#998f81] transition-colors mt-2"
          >
            Cancel & Go to Settings
          </button>
        </div>
      </div>
    </div>
  );
}
