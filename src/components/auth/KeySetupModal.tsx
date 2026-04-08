import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function KeySetupModal() {
  const { encryptionStatus, setupEncryption, unlockEncryption, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (encryptionStatus === 'ready' || encryptionStatus === 'initializing') return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 6) {
      setError('PIN must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (encryptionStatus === 'pin_setup_required') {
        await setupEncryption(pin);
      } else if (encryptionStatus === 'pin_unlock_required') {
        const success = await unlockEncryption(pin);
        if (!success) {
          setError('Invalid PIN. Please try again.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isSetup = encryptionStatus === 'pin_setup_required';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6">
      <div className="w-full max-w-md bg-[#16161c] border border-white/5 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
        {/* Aesthetic Background Elements */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[rgba(var(--primary-rgb),_0.1)] blur-[100px] rounded-full group-hover:bg-[rgba(var(--primary-rgb),_0.2)] transition-all duration-1000" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 blur-[100px] rounded-full group-hover:bg-purple-500/20 transition-all duration-1000" />

        <div className="flex flex-col items-center text-center space-y-6 relative z-10">
          <div className="w-16 h-16 bg-[rgba(var(--primary-rgb),_0.1)] rounded-2xl flex items-center justify-center border border-[rgba(var(--primary-rgb),_0.2)]">
            <span className="material-symbols-outlined text-3xl text-[var(--gold)]">
              {isSetup ? 'lock_reset' : 'lock_open'}
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="font-serif italic text-2xl text-[var(--gold)]">
              {isSetup ? 'Secure Your Sanctuary' : 'Unlock Your Aura'}
            </h2>
            <p className="text-sm text-[#998f81]/60 leading-relaxed">
              {isSetup 
                ? 'Create a recovery PIN to protect your private messages across all your devices.' 
                : 'Enter your Chat PIN to decrypt your private journey.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="relative">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter 6-digit PIN"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-center text-2xl tracking-[0.5em] text-[#e4e1ed] focus:outline-none focus:border-[rgba(var(--primary-rgb),_0.5)] focus:bg-white/[0.08] transition-all placeholder:text-[10px] placeholder:tracking-widest placeholder:uppercase placeholder:text-[#998f81]/40"
                maxLength={12}
                disabled={loading}
              />
              {error && (
                <p className="mt-2 text-[10px] text-red-400 uppercase tracking-widest font-bold">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || pin.length < 6}
              className="w-full bg-[var(--gold)] text-[var(--bg-primary)] font-bold py-4 rounded-2xl shadow-[0_0_20px_rgba(var(--primary-rgb),0.2)] hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-[var(--bg-primary)]/30 border-t-[var(--bg-primary)] rounded-full animate-spin" />
              ) : (
                <>
                  <span className="uppercase tracking-[0.2em] text-[11px]">
                    {isSetup ? 'Establish Connection' : 'Enter Sanctuary'}
                  </span>
                </>
              )}
            </button>
          </form>

          <button
            onClick={() => signOut()}
            className="text-[10px] uppercase tracking-widest text-[#998f81]/40 hover:text-[var(--gold)] transition-colors"
          >
            Sign out and return later
          </button>
        </div>
      </div>
    </div>
  );
}
