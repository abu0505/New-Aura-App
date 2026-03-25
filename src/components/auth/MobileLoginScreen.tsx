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
        toast.success('Account created! You are securely verified.');
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
      toast.error(error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');
        
        .bg-abstract {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: -1;
          background: radial-gradient(circle at 70% 30%, rgba(200, 163, 109, 0.15), #0a0e17);
        }

        .input-field:-webkit-autofill,
        .input-field:-webkit-autofill:hover, 
        .input-field:-webkit-autofill:focus, 
        .input-field:-webkit-autofill:active{
            -webkit-box-shadow: 0 0 0 30px #1a1f2b inset !important;
            -webkit-text-fill-color: white !important;
            transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#0a0e17', color: 'white', fontFamily: "'Inter', sans-serif" }}>
        {/* Abstract Background */}
        <div className="bg-abstract"></div>

        <main className="w-full max-w-md px-6 py-8 relative z-10 flex flex-col h-[884px]">
          {/* Header */}
          <header className="flex flex-col items-center mt-20 mb-10">
            <h1 className="text-4xl tracking-widest mb-10 uppercase" style={{ fontFamily: "'Playfair Display', serif", color: '#c8a36d' }}>Aura</h1>
            <div className="text-center space-y-3">
              <h2 className="text-4xl font-medium text-white tracking-wide" style={{ fontFamily: "'Playfair Display', serif" }}>
                {isSignUp ? 'Join Aura' : 'Welcome Back'}
              </h2>
              <p className="text-sm leading-relaxed max-w-[280px] mx-auto font-light" style={{ color: '#8C94A3' }}>
                {isSignUp 
                  ? 'Establish your identity to begin your shared journey.' 
                  : 'Enter your credentials to return to your shared sanctuary.'}
              </p>
            </div>
          </header>

          {/* LoginForm */}
          <form className="flex-1 flex flex-col w-full space-y-6" onSubmit={handleSubmit}>
            {/* Identity Input */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-white tracking-wider uppercase" htmlFor="email-mobile">Identity</label>
              <input 
                id="email-mobile" 
                type="email"
                placeholder="Email address" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field w-full rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-1 transition-colors font-light text-base"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: '1px' }}
              />
            </div>

            {/* Secret Key Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-medium text-white tracking-wider uppercase" htmlFor="password-mobile">Secret Key</label>
                {!isSignUp && (
                  <a href="#" className="text-[11px] tracking-wider uppercase transition-colors hover:text-[#e0c08f]" style={{ color: '#a68555' }}>Forgot Password?</a>
                )}
              </div>
              <div className="relative">
                <input 
                  id="password-mobile" 
                  type="password"
                  placeholder="Password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field w-full rounded-xl pl-4 pr-12 py-3.5 text-white focus:outline-none focus:ring-1 transition-colors font-light text-base"
                  style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: '1px' }}
                />
                <button type="button" className="absolute inset-y-0 right-0 pr-4 flex items-center transition-colors hover:text-white" style={{ color: '#8C94A3' }}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"></path>
                  </svg>
                </button>
              </div>
            </div>

            <div className="pt-4 space-y-6">
              {/* Primary Action */}
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-[#c8a36d] hover:bg-[#e0c08f] text-black font-medium rounded-full py-4 px-4 transition-colors tracking-widest text-sm uppercase disabled:opacity-50"
              >
                {loading ? 'Authenticating...' : (isSignUp ? 'Create Account' : 'Unlock Aura')}
              </button>

              {/* Divider */}
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-x-0 h-px bg-[rgba(255,255,255,0.1)]"></div>
                <span className="relative bg-[#0a0e17] px-4 text-[10px] uppercase tracking-widest" style={{ color: '#8C94A3' }}>Or</span>
              </div>

              {/* Secondary Action */}
              <button 
                type="button" 
                onClick={() => setIsSignUp(!isSignUp)}
                className="w-full bg-transparent border border-[#c8a36d] text-[#c8a36d] hover:bg-[rgba(255,255,255,0.05)] font-medium rounded-full py-4 px-4 transition-colors tracking-widest text-sm uppercase"
              >
                {isSignUp ? 'Already have an account?' : 'Create Account'}
              </button>
            </div>
          </form>

          {/* Footer */}
          <footer className="mt-auto pb-8 pt-6 text-center">
            <p className="text-[10px] tracking-wider uppercase leading-relaxed" style={{ color: '#8C94A3' }}>
              By entering, you agree to our <a href="#" className="text-[#c8a36d] hover:text-white transition-colors">Privacy<br/>Protocol</a> & <a href="#" className="text-[#c8a36d] hover:text-white transition-colors">Terms of Presence</a>
            </p>
            <p className="text-[10px] tracking-wider mt-3 uppercase" style={{ color: '#8C94A3' }}>
              © 2024 Aura. The Digital Sanctuary.
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}
