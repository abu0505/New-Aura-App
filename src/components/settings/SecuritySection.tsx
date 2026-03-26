import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { getStoredKeyPair, getKeyFingerprint, getPartnerPublicKey } from '../../lib/encryption';
import { checkPushSubscription, requestNotificationPermission, subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../../lib/pushNotifications';

export default function SecuritySection() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [userFingerprint, setUserFingerprint] = useState('');
  const [partnerFingerprint, setPartnerFingerprint] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    const keys = getStoredKeyPair();
    if (keys) {
      setUserFingerprint(getKeyFingerprint(keys.publicKey));
    }

    if (partner?.id) {
      getPartnerPublicKey(partner.id).then(key => {
        setPartnerFingerprint(getKeyFingerprint(key));
      }).catch(console.error);
    }

    checkPushSubscription().then(setPushEnabled);
  }, [partner?.id]);

  const togglePush = async () => {
    if (!user) return;
    try {
      if (pushEnabled) {
        await unsubscribeFromPushNotifications(user.id);
        setPushEnabled(false);
        alert('Universal Notifications disabled.');
      } else {
        const granted = await requestNotificationPermission();
        if (granted) {
          const success = await subscribeToPushNotifications(user.id);
          if (success) {
            setPushEnabled(true);
            alert('Universal Notifications active. Your sanctuary is now linked to your device.');
          } else {
            alert('Sanctuary connection failed. Please check your network or browser settings.');
          }
        } else {
          alert('Notification permission denied. Access the browser settings to enable sanctuary alerts.');
        }
      }
    } catch (err: any) {
      console.error('Push error', err);
      alert('Notification protocol error: ' + err.message);
    }
  };

  return (
    <>
      <div className="bg-[#1b1b23]/40 border border-white/5 rounded-[2.5rem] p-10 shadow-2xl hover:border-[#e6c487]/20 transition-all duration-500 group">
        <div className="flex items-center gap-4 mb-10">
          <span className="material-symbols-outlined text-[#e6c487] group-hover:rotate-12 transition-transform">lock</span>
          <h3 className="font-serif italic text-xl text-white">Privacy Protocol</h3>
        </div>
        
        <div className="space-y-8">
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl cursor-pointer hover:bg-white/10 transition-colors" onClick={togglePush}>
            <span className="text-xs uppercase tracking-widest text-white/60 font-label flex items-center gap-2">
              <span className="material-symbols-outlined text-[1rem]">notifications_active</span>
              Universal Notifications
            </span>
            <div className={`w-10 h-5 rounded-full relative transition-colors ${pushEnabled ? 'bg-[#e6c487]' : 'bg-white/10'}`}>
               <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${pushEnabled ? 'right-1 bg-[#412d00]' : 'left-1 bg-white/40'}`} />
            </div>
          </div>

          <div className="flex justify-between items-center p-4 rounded-xl border border-white/5 hover:border-[#e6c487]/20 transition-all" onClick={() => setShowVerify(true)}>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-widest text-white/60 font-label">Encryption Check</span>
              <span className="text-[10px] text-[#e6c487]/60 italic">Verify fingerprints for absolute trust</span>
            </div>
            <span className="material-symbols-outlined text-[#e6c487] text-lg">verified_user</span>
          </div>
        </div>
      </div>

      {/* Verification Modal */}
      {showVerify && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#0d0d15]/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-[#13131b] border border-[#e6c487]/20 w-full max-w-md rounded-[2.5rem] p-10 shadow-3xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#e6c487]/50 to-transparent" />
            
            <h2 className="font-serif italic text-3xl text-[#e6c487] mb-8 text-center uppercase tracking-widest">Protocol Trust</h2>
            
            <div className="space-y-12 mb-12">
              <div className="text-center">
                <p className="font-label text-[10px] uppercase tracking-[0.4em] text-white/40 mb-4">Your Fingerprint</p>
                <code className="text-[#e6c487] text-lg lg:text-xl font-mono tracking-wider break-all bg-white/5 p-4 rounded-2xl block">{userFingerprint}</code>
              </div>
              
              <div className="text-center">
                <p className="font-label text-[10px] uppercase tracking-[0.4em] text-white/40 mb-4">{partner?.display_name}'s Fingerprint</p>
                <code className="text-[#e6c487] text-lg lg:text-xl font-mono tracking-wider break-all bg-white/5 p-4 rounded-2xl block">{partnerFingerprint}</code>
              </div>
            </div>

            <p className="text-[10px] text-white/30 text-center leading-relaxed italic mb-10">
              For absolute security, confirm these sequences match what your partner sees in their own Sanctuary. 
              The fingerprint is a cryptographic summary of your Secure Vault's unique DNA.
            </p>

            <button 
              onClick={() => setShowVerify(false)}
              className="w-full bg-[#1b1b23] border border-white/5 text-white/60 py-4 rounded-2xl font-label text-[10px] uppercase tracking-[0.4em] hover:bg-white/5 transition-colors"
            >
              Seal Verification
            </button>
          </div>
        </div>
      )}
    </>
  );
}
