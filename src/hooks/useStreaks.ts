// useStreaks.ts — thin re-export from StreakContext.
// Kept for backward compatibility with App.tsx which calls `useStreaks()`.
// All logic now lives in StreakContext.tsx (real-time subscription, risk state, etc.)
export { useStreak as useStreaks } from '../contexts/StreakContext';
