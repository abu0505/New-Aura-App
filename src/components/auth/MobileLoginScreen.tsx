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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        .input-field:-webkit-autofill,
        .input-field:-webkit-autofill:hover, 
        .input-field:-webkit-autofill:focus, 
        .input-field:-webkit-autofill:active{
            -webkit-box-shadow: 0 0 0 30px #111111 inset !important;
            -webkit-text-fill-color: white !important;
            transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      
      <div className="min-h-[100dvh] flex flex-col items-center justify-center relative bg-[#0a0a0a] text-white font-sans overflow-hidden">
        <main className="w-full max-w-md px-6 py-8 relative z-10 flex flex-col h-[884px]">
          {/* Header */}
          <header className="flex flex-col items-center mt-20 mb-10">
            <div className="w-20 h-20 mb-6 flex items-center justify-center bg-white/5 rounded-2xl border border-white/10 shadow-xl">
               <span className="material-symbols-outlined text-4xl">shopping_bag</span>
            </div>
            <h1 className="text-2xl font-bold tracking-widest mb-10 uppercase text-white">Aura Store</h1>
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-semibold text-white tracking-wide">
                {isSignUp ? 'Create Account' : 'Welcome Back'}
              </h2>
              <p className="text-sm leading-relaxed max-w-[280px] mx-auto text-gray-400">
                {isSignUp 
                  ? 'Sign up to track your orders, save to your wishlist, and check out faster.' 
                  : 'Sign in to access your orders, saved items, and recommendations.'}
              </p>
            </div>
          </header>

          {/* LoginForm */}
          <form className="flex-1 flex flex-col w-full space-y-5" onSubmit={handleSubmit}>
            {/* Identity Input */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-400 tracking-wider uppercase" htmlFor="email-mobile">Email Address</label>
              <input 
                id="email-mobile" 
                type="email"
                placeholder="Enter your email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field w-full rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-1 focus:ring-white/30 transition-colors bg-white/5 border border-white/10 text-base"
              />
            </div>

            {/* Secret Key Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold text-gray-400 tracking-wider uppercase" htmlFor="password-mobile">Password</label>
                {!isSignUp && (
                  <a href="#" className="text-[11px] tracking-wider transition-colors text-gray-400 hover:text-white">Forgot Password?</a>
                )}
              </div>
              <div className="relative">
                <input 
                  id="password-mobile" 
                  type="password"
                  placeholder="Enter your password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field w-full rounded-xl pl-4 pr-12 py-3.5 text-white focus:outline-none focus:ring-1 focus:ring-white/30 transition-colors bg-white/5 border border-white/10 text-base"
                />
                <button type="button" className="absolute inset-y-0 right-0 pr-4 flex items-center transition-colors text-gray-400 hover:text-white">
                  <span className="material-symbols-outlined text-lg">visibility</span>
                </button>
              </div>
            </div>

            <div className="pt-4 space-y-6">
              {/* Primary Action */}
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-white hover:bg-gray-200 text-black font-bold rounded-xl py-4 px-4 transition-all tracking-wide text-sm disabled:opacity-50 active:scale-[0.98] shadow-lg shadow-white/10"
              >
                {loading ? 'Authenticating...' : (isSignUp ? 'Create Account' : 'Sign In')}
              </button>

              {/* Divider */}
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-x-0 h-px bg-white/10"></div>
                <span className="relative bg-[#0a0a0a] px-4 text-xs font-medium text-gray-500 uppercase">Or</span>
              </div>

              {/* Secondary Action */}
              <button 
                type="button" 
                onClick={() => setIsSignUp(!isSignUp)}
                className="w-full bg-transparent border border-white/20 text-white hover:bg-white/5 font-semibold rounded-xl py-4 px-4 transition-colors tracking-wide text-sm"
              >
                {isSignUp ? 'Already have an account? Sign In' : 'Create an Account'}
              </button>
            </div>
          </form>

          {/* Footer */}
          <footer className="mt-auto pb-8 pt-6 text-center">
            <p className="text-xs text-gray-500 leading-relaxed">
              By entering, you agree to our <a href="#" className="text-gray-300 hover:text-white underline transition-colors">Privacy Policy</a> & <a href="#" className="text-gray-300 hover:text-white underline transition-colors">Terms of Service</a>
            </p>
            <p className="text-xs text-gray-600 mt-4 uppercase tracking-widest font-semibold">
              © 2024 Aura Store. All rights reserved.
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}
