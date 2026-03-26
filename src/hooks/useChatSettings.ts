import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface ChatSettings {
  id: string;
  user_id: string;
  background_url: string | null;
  background_key: string | null;
  background_nonce: string | null;
  notification_sound: boolean;
  updated_at: string;
}

export function useChatSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from('chat_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // No settings yet, create default
        const { data: newData, error: insertError } = await supabase
          .from('chat_settings')
          .insert({ user_id: user.id })
          .select()
          .single();
        
        if (!insertError) setSettings(newData);
      } else if (!error) {
        setSettings(data);
      }
      setLoading(false);
    };

    fetchSettings();

    // Subscribe to ALL chat_settings changes (table has at most 2 rows)
    // so that partner-initiated background changes are picked up via sync_chat_settings RPC
    const channel = supabase
      .channel(`chat_settings_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_settings',
        },
        () => {
          // Re-fetch own row to get synced values
          refreshSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const updateSettings = async (updates: Partial<ChatSettings>) => {
    if (!user || !settings) return;
    
    // Optimistic Update
    const previousSettings = { ...settings };
    setSettings({ ...settings, ...updates, updated_at: new Date().toISOString() });

    const { error } = await supabase
      .from('chat_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    
    if (error) {
      // Rollback on error
      setSettings(previousSettings);
    }
    
    return { error };
  };

  const refreshSettings = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('chat_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();
    if (data) setSettings(data);
  };

  return { settings, loading, updateSettings, refreshSettings };
}
