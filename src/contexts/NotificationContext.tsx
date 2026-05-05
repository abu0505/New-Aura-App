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
  /** Dismiss all unread notifications sent by a specific user (called when their chat messages are read). */
  markReadBySenderId: (senderId: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  markReadBySenderId: async () => {},
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
        
        if (newNotif.recipient_id !== userId) return;

        // Add to state
        setNotifications(prev => [newNotif, ...prev]);

        // Fetch settings to check if toasts are allowed
        const { data: settings } = await supabase
          .from('chat_settings')
          .select('push_notifications_enabled')
          .eq('user_id', userId)
          .single();

        // Mark as seen_realtime if the document is visible so the Edge Function
        // skips sending a redundant Push Notification to the system tray.
        // We no longer show an in-app toast as it was found to be annoying during active chat.
        if (document.visibilityState === 'visible') {
          await supabase
            .from('notifications')
            .update({ seen_realtime: true })
            .eq('id', newNotif.id);
        }
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as Notification;
        // Only update our own notifications in state
        if (updated.recipient_id !== userId) return;
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

  /**
   * markReadBySenderId
   * Dismisses all unread notifications that were sent by `senderId`.
   * Called by chat screens when the user reads messages from a specific partner,
   * so the notification badge and inbox entry clear automatically.
   */
  const markReadBySenderId = async (senderId: string) => {
    const unreadFromSender = notifications.filter(
      n => n.sender_id === senderId && !n.read_at
    );
    if (unreadFromSender.length === 0) return;

    const readAt = new Date().toISOString();

    // Optimistic update
    setNotifications(prev =>
      prev.map(n =>
        n.sender_id === senderId && !n.read_at ? { ...n, read_at: readAt } : n
      )
    );

    await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .in('id', unreadFromSender.map(n => n.id));
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
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, markReadBySenderId }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
