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
        toast.success('Account created! You are securely verified.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back to your Sanctuary.');
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
        .aurora-gradient-desktop {
            background: radial-gradient(circle at 20% 30%, rgba(230, 196, 135, 0.08) 0%, transparent 40%),
                        radial-gradient(circle at 80% 70%, rgba(65, 45, 0, 0.15) 0%, transparent 50%),
                        radial-gradient(circle at 50% 50%, rgba(19, 19, 27, 1) 0%, rgba(13, 13, 21, 1) 100%);
        }
        .text-glow-gold {
            text-shadow: 0 0 20px rgba(230, 196, 135, 0.3);
        }
      `}</style>
      <main className="flex min-h-screen w-full bg-surface-container-lowest text-on-surface font-body selection:bg-primary-container selection:text-on-primary overflow-hidden">
        {/* Left Side: Hero/Branding */}
        <section className="hidden lg:flex flex-col justify-between w-7/12 p-20 aurora-gradient-desktop relative overflow-hidden">
          {/* Decorative Elements */}
          <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCPt3UQD2zhBjdcfz4vpoMnLVAO00p927weid8NJG3wHiiGD4FcU1P0MTD8VIMkLAfZM-917g3aicYjhSmb1SqSsCsuThtfGQQS7semr3pXlk2v9N0uWeQ10UsiwSLBcqBuSOhzePp3kU4MNVfyWGXDPMgOw6f_MWEozVvoD15vfsOjt4R6aaTsNn8QKsSyo1VpDaqwNU88qukxWfkWAdJpXUnG-yBBNzFfk4MykA2UpWQnCgOB4mCV3dS5wEZDn4RmtU6KFiU_yb8')" }}></div>
          <div className="z-10 flex flex-col items-start gap-4">
            <div className="flex items-center gap-2 opacity-60">
              <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
              <span className="text-[10px] tracking-[0.3em] uppercase font-label text-primary">End-to-end encrypted for two</span>
            </div>
          </div>
          
          <div className="z-10 flex flex-col justify-center flex-grow">
            <h1 className="font-headline text-8xl font-light tracking-[0.25em] text-primary text-glow-gold leading-tight mb-4">
              AURA
            </h1>
            <p className="font-headline italic text-2xl text-on-surface-variant font-light tracking-widest opacity-80">
              Your Private World
            </p>
          </div>
          
          <div className="z-10 flex flex-col gap-8">
            <div className="w-32 h-px bg-outline-variant opacity-30"></div>
            <div className="flex gap-12">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] tracking-widest uppercase text-outline">Intimacy</span>
                <span className="text-xs text-on-surface/60">Crafted for connection</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] tracking-widest uppercase text-outline">Security</span>
                <span className="text-xs text-on-surface/60">Zero-knowledge privacy</span>
              </div>
            </div>
          </div>
          
          {/* Background Ambient Image Layer */}
          <div className="absolute inset-0 opacity-10 pointer-events-none mix-blend-overlay">
            <img className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDggKZyHZC82wWLMBP-ZCFJ23iMF1LP-aPhtH9VSTVj3voyoGeExuWoH0mtS8yIyZwR2uhbD-TrJ-QPcpvnPmCy7uIfq15pXXBN0V2qO-LrW5YSshT7jVJhAcZ5NnEtlNNKgMOQoUoAv2Czddr90nG_XHej07gElVkLMkkX8KEOm5ddQSQXvSek9DM2suox42xcr7Uk0r9V0XWulKV1pKmv4fZDxSUTHY9fyxvid2BNpTofZKTx2oiTNFoZJG4KJfhCMR3n0R6Ue1o" />
          </div>
        </section>

        {/* Right Side: Login Form */}
        <section className="flex flex-col justify-center items-center w-full lg:w-5/12 bg-surface p-8 md:p-16 lg:p-24 relative overflow-y-auto">
          <div className="w-full max-w-md flex flex-col gap-12 pt-28">
            <header className="flex flex-col gap-3">
              <h2 className="font-headline text-4xl text-on-surface tracking-tight">
                {isSignUp ? 'Create Sanctuary' : 'Welcome Back'}
              </h2>
              <p className="text-on-surface-variant/70 text-sm leading-relaxed">
                {isSignUp ? 'Forge a secure space for you and your partner.' : 'Enter your credentials to return to your shared sanctuary.'}
              </p>
            </header>
            
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Email Field */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.2em] text-outline px-1" htmlFor="email">Identity</label>
                <div className="group relative">
                  <input 
                    className="w-full bg-surface-container-low border-none rounded-xl py-4 px-5 text-on-surface placeholder:text-on-surface-variant/30 focus:ring-1 focus:ring-primary/40 focus:outline-none transition-all duration-500 font-body text-sm" 
                    id="email" 
                    placeholder="Email address" 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              {/* Password Field */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end px-1">
                  <label className="text-[10px] uppercase tracking-[0.2em] text-outline" htmlFor="password">Secret Key</label>
                  {!isSignUp && (
                    <a className="text-[10px] uppercase tracking-[0.1em] text-primary/60 hover:text-primary transition-colors duration-300" href="#">Forgot password?</a>
                  )}
                </div>
                <div className="group relative">
                  <input 
                    className="w-full bg-surface-container-low border-none rounded-xl py-4 px-5 text-on-surface placeholder:text-on-surface-variant/30 focus:ring-1 focus:ring-primary/40 focus:outline-none transition-all duration-500 font-body text-sm" 
                    id="password" 
                    placeholder="••••••••" 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-primary transition-colors" type="button">
                    <span className="material-symbols-outlined text-xl">visibility</span>
                  </button>
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex flex-col gap-4 mt-4">
                <button 
                  disabled={loading}
                  type="submit" 
                  className="w-full bg-primary-container text-on-primary py-4 rounded-full font-label font-semibold tracking-widest uppercase text-xs hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all duration-300 shadow-xl shadow-primary/5"
                >
                  {loading ? 'Authenticating...' : (isSignUp ? 'Create Account' : 'Unlock AURA')}
                </button>
                
                <div className="flex items-center gap-4 py-2">
                  <div className="flex-grow h-px bg-outline-variant/20"></div>
                  <span className="text-[10px] uppercase tracking-widest text-outline/40">or</span>
                  <div className="flex-grow h-px bg-outline-variant/20"></div>
                </div>
                
                <button 
                  onClick={() => setIsSignUp(!isSignUp)}
                  type="button" 
                  className="w-full border border-outline-variant/30 text-on-surface py-4 rounded-full font-label font-semibold tracking-widest uppercase text-xs hover:bg-surface-container-high transition-all duration-300"
                >
                  {isSignUp ? 'Sign In Instead' : 'Create Account'}
                </button>
              </div>
            </form>
            
            <footer className="flex justify-center mt-8">
              <p className="text-[10px] text-outline/40 tracking-widest uppercase text-center max-w-xs leading-loose">
                  By entering, you agree to our <br/>
                  <a className="text-outline/60 hover:text-primary underline-offset-4 underline decoration-primary/20" href="#">Privacy Protocol</a> &amp; <a className="text-outline/60 hover:text-primary underline-offset-4 underline decoration-primary/20" href="#">Terms of Presence</a>
              </p>
            </footer>
          </div>
        </section>

        {/* Shared Footer Navigation */}
        <footer className="fixed bottom-0 left-0 w-full px-12 py-8 z-50 pointer-events-none hidden lg:block">
          <div className="flex justify-between items-center w-full opacity-60">
            <div className="flex gap-8 pointer-events-auto">
              <a className="text-[#4D463A] hover:text-[#E6C487] font-body text-[10px] tracking-[0.2em] uppercase transition-opacity duration-500" href="#">Privacy</a>
              <a className="text-[#4D463A] hover:text-[#E6C487] font-body text-[10px] tracking-[0.2em] uppercase transition-opacity duration-500" href="#">Terms</a>
              <a className="text-[#4D463A] hover:text-[#E6C487] font-body text-[10px] tracking-[0.2em] uppercase transition-opacity duration-500" href="#">Concierge</a>
            </div>
            <div className="text-[#4D463A] font-body text-[10px] tracking-[0.2em] uppercase">
                © 2024 AURA. THE DIGITAL SANCTUARY.
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
