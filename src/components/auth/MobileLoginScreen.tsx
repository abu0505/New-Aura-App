import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';

interface MobileLoginScreenProps {
  onLogin: () => void;
}

export default function MobileLoginScreen({ onLogin }: MobileLoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !password) {
       toast.error('Please enter email and password');
       return;
    }
    
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        toast.success('Account created! Verification email sent.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success('Welcome back to your Sanctuary.');
        onLogin();
      }
    } catch (error: any) {
      toast.error(error.message || 'Authentication error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        
        .login-bg-glow {
          position: absolute;
          width: 300px;
          height: 300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(201, 169, 110, 0.08) 0%, transparent 70%);
          filter: blur(40px);
          animation: float-glow 8s ease-in-out infinite alternate;
        }

        @keyframes float-glow {
          0% { transform: translate(-10%, -10%) scale(1); }
          100% { transform: translate(10%, 10%) scale(1.2); }
        }

        .input-field:-webkit-autofill,
        .input-field:-webkit-autofill:hover, 
        .input-field:-webkit-autofill:focus, 
        .input-field:-webkit-autofill:active{
            -webkit-box-shadow: 0 0 0 30px #13131e inset !important;
            -webkit-text-fill-color: #f0ede8 !important;
            transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      
      <div className="min-h-[100dvh] flex flex-col items-center justify-center relative bg-[#0c0c14] text-[#f0ede8] font-sans overflow-hidden">
        {/* Animated Glow Backdrops */}
        <div className="login-bg-glow top-12 left-10" />
        <div className="login-bg-glow bottom-12 right-10" style={{ animationDelay: '-4s' }} />

        <main className="w-full max-w-md px-6 py-12 relative z-10 flex flex-col h-[100dvh] justify-between">
          
          {/* Header & Branding */}
          <header className="flex flex-col items-center mt-12 mb-6 text-center">
            <div className="w-16 h-16 mb-5 flex items-center justify-center bg-white/[0.02] rounded-3xl border border-white/10 shadow-2xl relative group">
              <span className="material-symbols-outlined text-3xl text-[var(--gold)]">favorite</span>
              <div className="absolute inset-0 rounded-3xl bg-[var(--gold)]/10 blur-md opacity-50" />
            </div>
            
            <h1 className="text-4xl font-serif italic font-bold tracking-[0.25em] text-gradient-gold uppercase mb-2">AURA</h1>
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[var(--text-secondary)] mb-6">Our Private Space</p>
            
            <div className="space-y-2 max-w-[280px]">
              <h2 className="text-2xl font-bold tracking-wide text-white">
                {isSignUp ? 'Join the Sanctuary' : 'Welcome Back'}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {isSignUp 
                  ? 'Create a secure workspace to share memories, chat, and stories privately.' 
                  : 'Step inside to access your shared timeline, notes, and arcade.'}
              </p>
            </div>
          </header>

          {/* Form */}
          <form className="flex-1 flex flex-col justify-center space-y-5 my-8" onSubmit={handleSubmit}>
            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-white/50 tracking-widest uppercase" htmlFor="email-mobile">Email</label>
              <input 
                id="email-mobile" 
                type="email"
                placeholder="Enter your email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field w-full rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-[var(--gold)]/40 transition-colors bg-white/[0.03] border border-white/10 text-sm"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] font-bold text-white/50 tracking-widest uppercase" htmlFor="password-mobile">Password</label>
              </div>
              <input 
                id="password-mobile" 
                type="password"
                placeholder="Enter password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-field w-full rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-[var(--gold)]/40 transition-colors bg-white/[0.03] border border-white/10 text-sm"
              />
            </div>

            {/* Actions */}
            <div className="pt-4 space-y-4">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[#2a1e00] font-bold rounded-2xl py-3.5 px-4 transition-all tracking-wider text-xs uppercase disabled:opacity-50 active:scale-[0.98] shadow-lg shadow-[var(--gold-glow)]"
              >
                {loading ? 'Securing entrance...' : (isSignUp ? 'Create Workspace' : 'Enter')}
              </button>

              <button 
                type="button" 
                onClick={() => setIsSignUp(!isSignUp)}
                className="w-full text-center text-xs font-semibold text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors pt-2"
              >
                {isSignUp ? 'Already have a space? Enter here' : 'Need to set up a new space? Create account'}
              </button>
            </div>
          </form>

          {/* Footer */}
          <footer className="mt-auto pb-4 text-center">
            <p className="text-[10px] text-[var(--text-secondary)]/50 leading-relaxed max-w-[240px] mx-auto">
              End-to-end encryption keys are held locally in your browser session.
            </p>
            <p className="text-[9px] text-[var(--text-secondary)]/30 mt-3 uppercase tracking-widest font-semibold">
              © 2026 AURA. Private Sanctuary v2.0.0
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}
