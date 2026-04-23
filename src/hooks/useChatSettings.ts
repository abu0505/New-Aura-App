import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { realtimeHub } from '../lib/realtimeHub';

export interface ChatSettings {
  id: string;
  user_id: string;
  background_url: string | null;
  background_key: string | null;
  background_nonce: string | null;
  notification_enabled: boolean;
  updated_at: string;
  shared_pin: string | null;
  accent_color: string | null;
  true_dark_mode: boolean;
  quick_emojis: string[];
  notification_alias: string | null;
  notification_bodies: string[] | null;
}

export function useChatSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('chat_settings')
      .select('id,user_id,background_url,background_key,background_nonce,notification_enabled,updated_at,shared_pin,accent_color,true_dark_mode,quick_emojis,notification_alias,notification_bodies')
      .eq('user_id', user.id)
      .single();
    if (data) setSettings(data);
  };

  useEffect(() => {
    if (!user) return;

    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from('chat_settings')
        .select('id,user_id,background_url,background_key,background_nonce,notification_enabled,updated_at,shared_pin,accent_color,true_dark_mode,quick_emojis,notification_alias,notification_bodies')
        .eq('user_id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
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

    const handleLocalUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      setSettings(customEvent.detail);
    };
    window.addEventListener('chat-settings-updated', handleLocalUpdate);

    // ═══ Use RealtimeHub instead of creating a separate channel ═══
    // The hub already filters by user_id for chat_settings
    const unsubscribe = realtimeHub.on('chat_settings', () => {
      refreshSettings();
    });

    return () => {
      unsubscribe();
      window.removeEventListener('chat-settings-updated', handleLocalUpdate);
    };
  }, [user?.id]);

  const updateSettings = async (updates: Partial<ChatSettings>) => {
    if (!user || !settings) return;
    
    const previousSettings = { ...settings };
    const newSettings = { ...settings, ...updates, updated_at: new Date().toISOString() };
    
    setSettings(newSettings);
    window.dispatchEvent(new CustomEvent('chat-settings-updated', { detail: newSettings }));

    const { error } = await supabase
      .from('chat_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    
    if (error) {
      setSettings(previousSettings);
      window.dispatchEvent(new CustomEvent('chat-settings-updated', { detail: previousSettings }));
    }
    
    return { error };
  };

  const setSharedPin = async (newPinHash: string | null) => {
    if (!user) return { error: new Error("Not authenticated") };

    const newSettings = settings ? { ...settings, shared_pin: newPinHash } : null;
    setSettings(newSettings);
    if (newSettings) {
      window.dispatchEvent(new CustomEvent('chat-settings-updated', { detail: newSettings }));
    }

    const { error } = await supabase.rpc('set_shared_app_pin', {
      new_pin: newPinHash
    });

    if (error) {
       
       refreshSettings();
    }
    return { error };
  };

  return { settings, loading, updateSettings, setSharedPin, refreshSettings };
}
