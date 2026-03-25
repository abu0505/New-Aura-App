import { useState, useEffect } from 'react';
import MobileLoginScreen from './MobileLoginScreen';
import DesktopLoginScreen from './DesktopLoginScreen';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check initial width
    const checkWidth = () => {
      setIsDesktop(window.innerWidth >= 1024); // lg breakpoint in Tailwind
    };
    
    checkWidth();
    
    // Listen for resize events
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  return isDesktop ? (
    <DesktopLoginScreen onLogin={onLogin} />
  ) : (
    <MobileLoginScreen onLogin={onLogin} />
  );
}
