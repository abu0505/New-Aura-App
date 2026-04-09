import { useState, useEffect } from 'react';

/**
 * Formats a last_seen ISO timestamp into a human-readable string.
 * Single source of truth used by both Mobile and Desktop headers.
 */
export function formatLastSeen(lastSeen: string | null, compact?: boolean): string {
  if (!lastSeen) return compact ? 'Offline' : 'Offline';
  const diff = Date.now() - new Date(lastSeen).getTime();
  const totalMins = Math.floor(diff / 60000);

  if (totalMins < 1) return compact ? 'Just now' : 'Last seen just now';
  
  if (totalMins < 60) {
    const label = totalMins === 1 ? 'min' : 'mins';
    return compact ? `${totalMins} ${label} ago` : `Last seen ${totalMins} ${label} ago`;
  }

  const hours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;

  if (hours < 24) {
    const hourLabel = hours === 1 ? 'hour' : 'hours';
    if (compact) {
      const minsPart = remainingMins > 0 ? ` ${remainingMins}M` : '';
      return `${hours}H${minsPart} ago`;
    }
    const minLabel = remainingMins === 1 ? 'min' : 'mins';
    const minsPart = remainingMins > 0 ? ` ${remainingMins} ${minLabel}` : '';
    return `Last seen ${hours} ${hourLabel}${minsPart} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return compact ? 'Yesterday' : 'Last seen yesterday';
  return compact ? `${days} days ago` : `Last seen ${days} days ago`;
}

interface LastSeenStatusProps {
  isOnline: boolean;
  lastSeen: string | null;
  /** Use compact format for mobile (no "Last seen" prefix) */
  compact?: boolean;
}

/**
 * Auto-refreshing last-seen status text — WhatsApp style.
 *   Online  → "Online"
 *   Offline → "Last seen X ago" (refreshes every 30s)
 */
export function LastSeenStatus({ isOnline, lastSeen, compact }: LastSeenStatusProps) {
  // Tick state forces re-render every 30s for time freshness
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isOnline) return; // Online needs no tick
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [isOnline]);

  if (isOnline) {
    return <>Online</>;
  }

  return <>{formatLastSeen(lastSeen, compact)}</>;
}
