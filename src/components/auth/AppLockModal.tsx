import React, { useState, useRef } from 'react';
import { useAppLock, prefetchFeed } from '../../contexts/AppLockContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';

export default function AppLockModal() {
  const { isLocked, unlockApp } = useAppLock();
  const { user } = useAuth();
  const { partner } = usePartner();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // We intentionally remove the auto-focus to make it look like a real e-commerce page,
  // preventing the keyboard from popping up immediately and looking suspicious.

  if (!isLocked) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) {
      setError('Invalid discount code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const success = await unlockApp(pin);
      if (!success) {
        setError('Invalid discount code');
        setPin(''); // clear pin on failure
      }
    } catch (err) {
      setError('System error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0a0a0a] text-white font-sans transition-all duration-500 overflow-y-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-white/10 sticky top-0 bg-[#0a0a0a]/90 backdrop-blur-md z-20">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-2xl cursor-pointer hover:text-gray-300 transition-colors">arrow_back</span>
          <h1 className="text-lg font-bold tracking-widest uppercase">Your Cart</h1>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined text-2xl">shopping_bag</span>
          <span className="absolute -top-1 -right-1 bg-white text-black text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            2
          </span>
        </div>
      </header>

      {/* Two Column Layout Container */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 lg:p-12 flex flex-col md:flex-row gap-12 lg:gap-20">
        
        {/* Left Side: Cart Items */}
        <div className="flex-1 space-y-8">
          <div className="hidden md:flex justify-between border-b border-white/10 pb-4 mb-4">
             <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Product</h2>
             <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Total</h2>
          </div>

          {/* Item 1 */}
          <div className="flex gap-5">
            <div className="w-28 h-32 bg-gray-900 rounded-2xl overflow-hidden flex-shrink-0 border border-white/5">
              <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&q=80" alt="Watch" className="w-full h-full object-cover opacity-90" />
            </div>
            <div className="flex-1 flex flex-col justify-between py-1">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-base text-gray-100">Minimalist Smartwatch</h3>
                  <p className="text-sm text-gray-400 mt-1">Matte Black / 42mm</p>
                </div>
                <span className="font-bold text-lg hidden md:block">$199.00</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="font-bold text-lg md:hidden">$199.00</span>
                <div className="flex items-center gap-4 bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                  <span className="material-symbols-outlined text-sm cursor-pointer text-gray-400 hover:text-white transition-colors">remove</span>
                  <span className="text-sm font-medium w-4 text-center">1</span>
                  <span className="material-symbols-outlined text-sm cursor-pointer text-gray-400 hover:text-white transition-colors">add</span>
                </div>
              </div>
            </div>
          </div>

          {/* Item 2 */}
          <div className="flex gap-5">
            <div className="w-28 h-32 bg-gray-900 rounded-2xl overflow-hidden flex-shrink-0 border border-white/5">
              <img src="https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=300&q=80" alt="T-Shirt" className="w-full h-full object-cover opacity-90" />
            </div>
            <div className="flex-1 flex flex-col justify-between py-1">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-base text-gray-100">Essential Heavyweight Tee</h3>
                  <p className="text-sm text-gray-400 mt-1">Off-White / Medium</p>
                </div>
                <span className="font-bold text-lg hidden md:block">$45.00</span>
              </div>
              <div className="flex justify-between items-end">
                <span className="font-bold text-lg md:hidden">$45.00</span>
                <div className="flex items-center gap-4 bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                  <span className="material-symbols-outlined text-sm cursor-pointer text-gray-400 hover:text-white transition-colors">remove</span>
                  <span className="text-sm font-medium w-4 text-center">1</span>
                  <span className="material-symbols-outlined text-sm cursor-pointer text-gray-400 hover:text-white transition-colors">add</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Order Summary */}
        <div className="w-full md:w-[380px] lg:w-[420px] flex flex-col gap-8">
          
          {/* Promo Code Section (The actual PIN input) */}
          <div className="space-y-4 bg-white/[0.02] p-6 rounded-2xl border border-white/5">
            <label className="text-xs font-semibold uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">loyalty</span>
              Gift card or discount code
            </label>
            <form onSubmit={handleSubmit} className="relative flex gap-3">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="password"
                  value={pin}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPin(val);
                    setError(null);
                    if (val.length >= 1 && user?.id && partner?.id) {
                      prefetchFeed(user.id, partner.id);
                    }
                  }}
                  placeholder="Enter code..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-base text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder:text-gray-600"
                  maxLength={10}
                  disabled={loading}
                />
                {error && (
                  <p className="absolute -bottom-6 left-2 text-[11px] text-red-400 font-medium">
                    {error}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || pin.length === 0}
                className="bg-white text-black px-6 rounded-xl font-bold text-sm disabled:opacity-50 disabled:bg-gray-300 transition-all active:scale-95 flex items-center justify-center min-w-[90px] shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  "Apply"
                )}
              </button>
            </form>
          </div>

          {/* Order Summary & Checkout */}
          <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5 space-y-6">
            <h2 className="text-sm font-semibold text-white uppercase tracking-widest mb-4">Order Summary</h2>
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-gray-400">
                <span>Subtotal</span>
                <span className="text-white font-medium">$244.00</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>Shipping</span>
                <span className="text-white font-medium">Free Express</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>Taxes</span>
                <span className="text-white font-medium">$0.00</span>
              </div>
            </div>
            
            <div className="flex justify-between items-center pt-4 border-t border-white/10">
              <span className="font-semibold text-lg">Total</span>
              <span className="text-2xl font-bold">$244.00</span>
            </div>

            <button className="w-full bg-white text-black font-bold py-4 rounded-xl hover:bg-gray-200 active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-4 shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              <span className="text-base">Proceed to Checkout</span>
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
