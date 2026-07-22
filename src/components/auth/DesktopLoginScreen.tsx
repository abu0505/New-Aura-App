import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';

interface DesktopLoginScreenProps {
  onLogin: () => void;
}

export default function DesktopLoginScreen({ onLogin }: DesktopLoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
       toast.error('Please enter email and password');
       return;
    }
    
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success('Account created! Verification email sent.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back to Aura.');
        onLogin();
      }
    } catch (error: any) {
      toast.error(error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');

        .aurora-bg-desktop {
          background: radial-gradient(circle at 10% 20%, rgba(201, 169, 110, 0.05) 0%, transparent 40%),
                      radial-gradient(circle at 90% 80%, rgba(201, 169, 110, 0.08) 0%, transparent 50%),
                      radial-gradient(circle at 50% 50%, rgba(19, 19, 27, 1) 0%, rgba(12, 12, 20, 1) 100%);
        }
        
        .glass-login-card {
          background: rgba(28, 28, 46, 0.45);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.05);
        }

        .gold-focus:focus {
          border-color: rgba(201, 169, 110, 0.4) !important;
          box-shadow: 0 0 0 2px rgba(201, 169, 110, 0.15) !important;
        }

        /* Particle flow animations */
        .glow-particle {
          position: absolute;
          border-radius: 50%;
          background: rgba(201, 169, 110, 0.2);
          filter: blur(8px);
          animation: float-particle 15s infinite ease-in-out;
        }

        @keyframes float-particle {
          0%, 100% { transform: translateY(0px) translateX(0px) scale(1); opacity: 0.1; }
          50% { transform: translateY(-80px) translateX(40px) scale(1.3); opacity: 0.4; }
        }
      `}</style>
      <main className="relative flex min-h-screen w-full items-center justify-center aurora-bg-desktop text-white font-sans overflow-hidden p-6">
        
        {/* Floating Ambient Particles */}
        <div className="glow-particle w-32 h-32 top-[15%] left-[20%]" style={{ animationDelay: '0s' }}></div>
        <div className="glow-particle w-48 h-48 bottom-[10%] right-[15%]" style={{ animationDelay: '-5s', animationDuration: '20s' }}></div>
        <div className="glow-particle w-24 h-24 top-[65%] left-[10%]" style={{ animationDelay: '-10s', animationDuration: '18s' }}></div>
        
        {/* Centered Glass Login Card */}
        <section className="relative z-10 w-full max-w-lg glass-login-card rounded-[32px] p-10 md:p-14 flex flex-col items-center">
          
          {/* Logo / Lock Indicator */}
          <header className="flex flex-col items-center text-center w-full mb-10">
            <div className="w-14 h-14 mb-5 flex items-center justify-center bg-white/[0.02] rounded-2xl border border-white/10 shadow-xl relative group">
              <span className="material-symbols-outlined text-2xl text-[var(--gold)]">lock</span>
              <div className="absolute inset-0 rounded-2xl bg-[var(--gold)]/10 blur-md opacity-40 group-hover:opacity-60 transition-opacity" />
            </div>
            
            <h1 className="text-4xl md:text-5xl font-serif italic font-bold tracking-[0.25em] text-gradient-gold uppercase mb-2">AURA</h1>
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[var(--text-secondary)]">Your private world, together.</p>
          </header>

          <div className="w-full text-center mb-6">
            <h2 className="text-xl md:text-2xl font-bold tracking-wide text-white">
              {isSignUp ? 'Create Workspace' : 'Welcome Back'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]/70 mt-1.5 leading-relaxed max-w-sm mx-auto">
              {isSignUp 
                ? 'Establish a private sanctuary to share messages, stories, and reels safely.' 
                : 'Access your fully encrypted timeline and chat space.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
            {/* Email Field */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]/60 px-1" htmlFor="email-desktop">Email Address</label>
              <input 
                id="email-desktop" 
                type="email"
                placeholder="Enter email address" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-3.5 px-5 text-white placeholder:text-white/20 focus:outline-none transition-all duration-300 font-body text-sm gold-focus" 
              />
            </div>
            
            {/* Password Field */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]/60 px-1" htmlFor="password-desktop">Password</label>
              <input 
                id="password-desktop" 
                type="password"
                placeholder="Enter password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-3.5 px-5 text-white placeholder:text-white/20 focus:outline-none transition-all duration-300 font-body text-sm gold-focus" 
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-4 mt-6">
              <button 
                disabled={loading}
                type="submit" 
                className="w-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-light)] hover:brightness-110 active:scale-[0.98] text-[#2a1e00] py-3.5 rounded-2xl font-bold tracking-widest uppercase text-xs disabled:opacity-50 disabled:active:scale-100 transition-all duration-300 shadow-lg shadow-[var(--gold-glow)]"
              >
                {loading ? 'Securing entrance...' : (isSignUp ? 'Create Workspace' : 'Enter AURA')}
              </button>
              
              <button 
                onClick={() => setIsSignUp(!isSignUp)}
                type="button" 
                className="w-full text-center text-xs font-semibold text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors pt-2"
              >
                {isSignUp ? 'Already have a space? Enter here' : 'Need to set up a new space? Create account'}
              </button>
            </div>
          </form>

          {/* Secure Message Footer */}
          <footer className="mt-10 text-center border-t border-white/5 pt-6 w-full">
            <p className="text-[10px] text-[var(--text-secondary)]/50 leading-relaxed max-w-xs mx-auto">
              Keys are held locally in your browser. All communications are end-to-end encrypted.
            </p>
            <p className="text-[9px] text-[var(--text-secondary)]/30 mt-3 uppercase tracking-widest font-semibold">
              © 2026 AURA. Private Sanctuary v2.26.0
            </p>
          </footer>
        </section>
      </main>
    </>
  );
}
