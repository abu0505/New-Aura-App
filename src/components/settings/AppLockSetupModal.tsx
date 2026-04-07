import React, { useState } from 'react';
import { useAppLock } from '../../contexts/AppLockContext';

interface AppLockSetupModalProps {
  onClose: () => void;
  isRemoving?: boolean;
}

export default function AppLockSetupModal({ onClose, isRemoving }: AppLockSetupModalProps) {
  const { setAppPin, unlockApp, hasAppPin } = useAppLock();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>(
    isRemoving ? 'current' : hasAppPin ? 'current' : 'new'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    // Changing / Removing requires current PIN first
    if (step === 'current') {
      if (pin.length < 4) {
        setError('PIN must be at least 4 digits');
        return;
      }
      setLoading(true);
      const valid = await unlockApp(pin);
      setLoading(false);
      
      if (valid) {
        setPin('');
        setError(null);
        if (isRemoving) {
          await executeRemoval();
        } else {
          setStep('new');
        }
      } else {
        setError('Incorrect Current PIN');
      }
      return;
    }

    if (step === 'new') {
      if (pin.length < 4 || pin.length > 6) {
        setError('PIN must be 4 to 6 digits');
        return;
      }
      setStep('confirm');
      setError(null);
      return;
    }

    if (step === 'confirm') {
      if (confirmPin !== pin) {
        setError('PINs do not match');
        setConfirmPin('');
        return;
      }
      await executeSetup();
    }
  };

  const executeSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const success = await setAppPin(pin);
      if (success) {
        onClose();
      } else {
        setError('Failed to update PIN. Try again.');
      }
    } catch (err) {
      setError('System Error');
    } finally {
      setLoading(false);
    }
  };

  const executeRemoval = async () => {
    setLoading(true);
    try {
      await setAppPin(null);
      onClose();
    } catch (err) {
      setError('Failed to remove PIN');
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    if (isRemoving) return "Remove Sanctuary Lock";
    if (step === 'current') return "Verify Identity";
    if (step === 'new') return hasAppPin ? "Change Lock PIN" : "Setup Sanctuary Lock";
    return "Confirm New PIN";
  };

  const getSubtitle = () => {
    if (isRemoving) return "Enter your current PIN to remove the lock.";
    if (step === 'current') return "Enter your current Sanctuary PIN.";
    if (step === 'new') return "Enter a 4-6 digit shared PIN.";
    return "Re-enter the new PIN to confirm.";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[var(--bg-primary)]/90 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="bg-[var(--bg-secondary)] border border-[var(--gold)]/20 w-full max-w-md rounded-[2.5rem] p-10 shadow-3xl overflow-hidden relative group">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--gold)]/50 to-transparent" />
        
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-16 h-16 bg-[var(--gold)]/10 rounded-2xl flex items-center justify-center border border-[var(--gold)]/20">
            <span className="material-symbols-outlined text-3xl text-[var(--gold)]">
              {isRemoving ? 'lock_open_right' : step === 'current' ? 'password' : 'lock'}
            </span>
          </div>

          <div className="space-y-2">
             <h2 className="font-serif italic text-2xl text-[var(--gold)] tracking-wider">
               {getTitle()}
             </h2>
             <p className="font-label text-xs tracking-widest uppercase text-[var(--text-secondary)]/60">
               {getSubtitle()}
             </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
             <div className="relative">
                <input
                  type="password"
                  value={step === 'confirm' ? confirmPin : pin}
                  onChange={(e) => {
                    if (step === 'confirm') setConfirmPin(e.target.value);
                    else setPin(e.target.value);
                    setError(null);
                  }}
                  placeholder={step === 'confirm' ? 'CONFIRM PIN' : 'ENTER PIN'}
                  className="w-full bg-[var(--bg-primary)]/50 border border-white/5 rounded-2xl px-6 py-4 text-center text-3xl tracking-[0.5em] text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/40 transition-all placeholder:text-[10px] placeholder:tracking-[0.3em] placeholder:uppercase placeholder:text-[var(--text-secondary)]/30"
                  maxLength={6}
                  autoFocus
                  disabled={loading}
                />
               {error && (
                 <p className="absolute -bottom-6 left-0 right-0 text-center text-[10px] text-red-400 uppercase tracking-widest font-bold">
                   {error}
                 </p>
               )}
             </div>

             <button
               type="submit"
               disabled={loading || (step === 'confirm' ? confirmPin.length < 4 : pin.length < 4)}
               className="w-full bg-[var(--gold)] text-black font-bold py-4 rounded-2xl mt-8 disabled:opacity-50 transition-all flex justify-center uppercase tracking-widest text-[11px]"
             >
               {loading ? 'Processing...' : step === 'new' ? 'Continue' : isRemoving ? 'Remove Lock' : 'Confirm'}
             </button>
             
             <button
                type="button"
                onClick={onClose}
                className="w-full bg-transparent border border-white/5 text-white/40 font-bold py-4 rounded-2xl transition-all hover:bg-white/5 uppercase tracking-widest text-[11px]"
             >
                Cancel
             </button>
          </form>
        </div>
      </div>
    </div>
  );
}
