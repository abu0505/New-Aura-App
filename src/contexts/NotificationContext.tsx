import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { realtimeHub } from '../lib/realtimeHub';
import { toast } from 'sonner';

export type Notification = {
  id: string;
  recipient_id: string;
  sender_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  seen_realtime: boolean;
  seen_push: boolean;
  read_at: string | null;
  created_at: string;
};

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  const unreadCount = notifications.filter(n => !n.read_at).length;

  // 1. Fetch Inbox (Layer 3)
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
        
      if (!error && data) {
        setNotifications(data as Notification[]);
      }
    };

    fetchNotifications();
  }, [userId]);

  // 2. Listen to Realtime (Layer 1)
  useEffect(() => {
    if (!userId) return;

    const unsubscribe = realtimeHub.on('notifications', async (payload) => {
      if (payload.eventType === 'INSERT') {
        const newNotif = payload.new as Notification;
        
        // Ensure it's for us (realtimeHub already filters, but just in case)
        if (newNotif.recipient_id !== userId) return;

        // Add to state
        setNotifications(prev => [newNotif, ...prev]);

        // Show Toast if the document is visible
        if (document.visibilityState === 'visible') {
          toast(newNotif.title, {
            description: newNotif.body,
            icon: '🔔',
          });
          
          // Deduplication mechanism: Mark as seen_realtime so the Edge Function
          // skips sending a Push Notification
          await supabase
            .from('notifications')
            .update({ seen_realtime: true })
            .eq('id', newNotif.id);
        }
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as Notification;
        setNotifications(prev => prev.map(n => n.id === updated.id ? updated : n));
      }
    });

    return () => unsubscribe();
  }, [userId]);

  const markAsRead = async (id: string) => {
    // Optimistic update
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, read_at: new Date().toISOString() } : n
    ));
    
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
    if (unreadIds.length === 0) return;
    
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));

    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds);
  };

  // 3. Listen to Service Worker postMessage
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICKED') {
        const notifId = event.data.notificationId;
        if (notifId) {
          await markAsRead(notifId);
        }
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleMessage);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
