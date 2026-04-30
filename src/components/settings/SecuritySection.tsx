import { useState, useEffect } from 'react';
import { usePartner } from '../../hooks/usePartner';
import { getStoredKeyPair, getKeyFingerprint, getPartnerPublicKey } from '../../lib/encryption';
import { useAppLock } from '../../contexts/AppLockContext';
import AppLockSetupModal from './AppLockSetupModal';

export default function SecuritySection() {
  const { partner } = usePartner();
  const [userFingerprint, setUserFingerprint] = useState('');
  const [partnerFingerprint, setPartnerFingerprint] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  
  const { hasAppPin } = useAppLock();
  const [showAppLockSetup, setShowAppLockSetup] = useState(false);
  const [appLockSetupMode, setAppLockSetupMode] = useState<'setup' | 'remove'>('setup');

  useEffect(() => {
    const keys = getStoredKeyPair();
    if (keys) {
      setUserFingerprint(getKeyFingerprint(keys.publicKey));
    }

    if (partner?.id) {
      getPartnerPublicKey(partner.id).then(key => {
        setPartnerFingerprint(getKeyFingerprint(key));
      }).catch(() => {});
    }
  }, [partner?.id]);

  return (
    <>
      <div className="bg-[var(--bg-secondary)] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl hover:border-[var(--gold)]/20 transition-all duration-500 group">
        <div className="flex items-center gap-4 mb-10">
          <span className="material-symbols-outlined text-[var(--gold)] group-hover:rotate-12 transition-transform">lock</span>
          <h3 className="font-serif italic text-xl text-white">Privacy Policy</h3>
        </div>
        
        <div className="space-y-4">
          <div className="flex justify-between items-center p-4 rounded-xl border border-white/5 hover:border-[var(--gold)]/20 transition-all font-label text-[11px] bg-white/5 cursor-pointer" onClick={() => setShowVerify(true)}>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-white/60">Encryption Check</span>
              <span className="text-[10px] text-[var(--gold)]/60 italic">Verify fingerprints for absolute trust</span>
            </div>
            <span className="material-symbols-outlined text-[var(--gold)] text-lg">verified_user</span>
          </div>

          {!hasAppPin ? (
            <div className="flex justify-between items-center p-4 rounded-xl border border-white/5 hover:border-[var(--gold)]/20 transition-all cursor-pointer" onClick={() => { setAppLockSetupMode('setup'); setShowAppLockSetup(true); }}>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-widest text-white/60 font-label">App Lock</span>
                <span className="text-[10px] text-[var(--gold)]/60 italic">Require a PIN to access the app</span>
              </div>
              <span className="material-symbols-outlined text-white/30 text-lg">lock_open</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center p-4 rounded-xl border border-white/5 hover:border-[var(--gold)]/20 transition-all cursor-pointer" onClick={() => { setAppLockSetupMode('setup'); setShowAppLockSetup(true); }}>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-white/60 font-label">Change Lock PIN</span>
                  <span className="text-[10px] text-[var(--gold)]/60 italic">App Lock is active</span>
                </div>
                <span className="material-symbols-outlined text-[var(--gold)] text-lg">password</span>
              </div>
              <div className="flex justify-between items-center p-4 rounded-xl border border-red-500/10 hover:border-red-500/30 transition-all cursor-pointer" onClick={() => { setAppLockSetupMode('remove'); setShowAppLockSetup(true); }}>
                <div className="flex flex-col gap-1">
                 <span className="text-xs uppercase tracking-widest text-red-400 font-label">Remove Lock</span>
                </div>
                <span className="material-symbols-outlined text-red-400 text-lg">lock_open_right</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Verification Modal */}
      {showVerify && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[var(--bg-primary)]/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-[var(--bg-secondary)] border border-[var(--gold)]/20 w-full max-w-md rounded-[2.5rem] p-10 shadow-3xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--gold)]/50 to-transparent" />
            
            <h2 className="font-serif italic text-3xl text-[var(--gold)] mb-8 text-center uppercase tracking-widest">Security Settings</h2>
            
            <div className="space-y-12 mb-12">
              <div className="text-center">
                <p className="font-label text-[10px] uppercase tracking-[0.4em] text-white/40 mb-4">Your Fingerprint</p>
                <code className="text-[var(--gold)] text-lg lg:text-xl font-mono tracking-wider break-all bg-white/5 p-4 rounded-2xl block">{userFingerprint}</code>
              </div>
              
              <div className="text-center">
                <p className="font-label text-[10px] uppercase tracking-[0.4em] text-white/40 mb-4">{partner?.display_name}'s Fingerprint</p>
                <code className="text-[var(--gold)] text-lg lg:text-xl font-mono tracking-wider break-all bg-white/5 p-4 rounded-2xl block">{partnerFingerprint}</code>
              </div>
            </div>

            <p className="text-[10px] text-white/30 text-center leading-relaxed italic mb-10">
              The fingerprint is a cryptographic summary of your app's unique security key.
            </p>

            <button 
              onClick={() => setShowVerify(false)}
              className="w-full bg-[var(--bg-secondary)] border border-white/5 text-white/60 py-4 rounded-2xl font-label text-[10px] uppercase tracking-[0.4em] hover:bg-white/5 transition-colors"
            >
              Seal Verification
            </button>
          </div>
        </div>
      )}

      {showAppLockSetup && (
        <AppLockSetupModal 
          onClose={() => setShowAppLockSetup(false)} 
          isRemoving={appLockSetupMode === 'remove'} 
        />
      )}
    </>
  );
}
