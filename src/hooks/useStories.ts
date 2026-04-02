import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';
import { encryptMessage, decryptMessage, getStoredKeyPair, decodeBase64, encodeBase64 } from '../lib/encryption';
import { realtimeHub } from '../lib/realtimeHub';
import type { Database } from '../integrations/supabase/types';

type StoryRow = Database['public']['Tables']['stories']['Row'];

export interface Story extends StoryRow {
  decrypted_content?: string;
  decrypted_media_url?: string;
  is_mine: boolean;
  type?: string;
}

export function useStories() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  // ═══ CRITICAL FIX: Use REFS for partner/user to avoid dependency cascading ═══
  // Previously, `decryptStoryRow` depended on [user?.id, partner?.public_key],
  // and `fetchStories` depended on [user, partner, decryptStoryRow].
  // ANY profile update (last_seen, is_online, status_message) created a NEW
  // partner object → new decryptStoryRow → new fetchStories → effect re-fires.
  // This caused 30+ stories fetches PER SECOND, burning ~80% of egress.
  const userRef = useRef(user);
  const partnerRef = useRef(partner);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { partnerRef.current = partner; }, [partner]);

  const decryptStoryRow = useCallback((row: StoryRow, myKeyPair: { secretKey: Uint8Array, publicKey: Uint8Array }): Story => {
    const currentUser = userRef.current;
    const currentPartner = partnerRef.current;
    const isMine = row.user_id === currentUser?.id;
    let decryptedText = '';

    if (currentPartner?.public_key && myKeyPair) {
      if (row.encrypted_content && row.media_nonce) {
        try {
          const senderKey = row.sender_public_key || currentPartner.public_key;
          const result = decryptMessage(
            row.encrypted_content,
            row.media_nonce,
            decodeBase64(senderKey),
            myKeyPair.secretKey
          );
          decryptedText = result;
        } catch (e) {
          console.error('Story decryption failed', e);
          decryptedText = '[Decryption Failed]';
        }
      }
    }

    return {
      ...row,
      decrypted_content: decryptedText || (row.encrypted_content ? '[Locked Memory]' : ''),
      is_mine: isMine,
    };
  }, []); // ═══ NO DEPS — uses refs internally ═══

  useEffect(() => {
    if (!user || !partner) return;

    const fetchStories = async () => {
      setLoading(true);
      try {
        const myKeyPair = getStoredKeyPair();
        
        const { data, error } = await supabase
          .from('stories')
          .select('id,user_id,encrypted_content,media_url,media_key,media_nonce,expires_at,viewed_at,created_at,sender_public_key')
          .or(`user_id.eq.${user.id},user_id.eq.${partner.id}`)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (myKeyPair && data) {
          const now = new Date();
          const validStories = data.filter(r => new Date(r.expires_at) > now);
          setStories(validStories.map(row => decryptStoryRow(row, myKeyPair)));
        } else {
          const now = new Date();
          const validStories = (data || []).filter(r => new Date(r.expires_at) > now);
          setStories(validStories.map(row => ({ ...row, is_mine: row.user_id === user.id })));
        }
      } catch (err) {
        console.error('Error fetching stories:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStories();

    // ═══ Use RealtimeHub instead of creating a separate channel ═══
    const unsubscribe = realtimeHub.on('stories', (payload) => {
      const myKeyPair = getStoredKeyPair();
      if (payload.eventType === 'INSERT' && myKeyPair) {
        const row = payload.new as StoryRow;
        const now = new Date();
        if (new Date(row.expires_at) > now) {
          const decrypted = decryptStoryRow(row, myKeyPair);
          setStories(prev => {
            if (prev.some(s => s.id === row.id)) return prev;
            return [decrypted, ...prev];
          });
        }
      } else if (payload.eventType === 'UPDATE') {
        setStories(prev => prev.map(s =>
          s.id === (payload.new as any).id ? { ...s, ...payload.new } : s
        ));
      } else if (payload.eventType === 'DELETE') {
        setStories(prev => prev.filter(s => s.id !== (payload.old as any).id));
      }
    });

    return () => {
      unsubscribe();
    };
  // ═══ CRITICAL: Only depend on PRIMITIVE IDs, not object references ═══
  // user?.id and partner?.id are strings that only change on login/logout,
  // NOT on every profile update like the full `partner` object does.
  }, [user?.id, partner?.id, decryptStoryRow]);

  const addStory = async (content: string, media?: { url: string, media_key: string, media_nonce: string, type: string }) => {
    if (!user || !partner?.public_key) return;

    const myKeyPair = getStoredKeyPair();
    if (!myKeyPair) return;

    let finalNonce = media?.media_nonce;
    let encryptedText = '';

    if (content) {
      const { ciphertext, nonce } = encryptMessage(content, decodeBase64(partner.public_key), myKeyPair.secretKey);
      encryptedText = ciphertext;
      if (!finalNonce) finalNonce = nonce;
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { error } = await supabase
      .from('stories')
      .insert({
        user_id: user.id,
        encrypted_content: encryptedText,
        media_url: media?.url || null,
        media_key: media?.media_key || null,
        media_nonce: finalNonce || null,
        expires_at: expiresAt.toISOString(),
        sender_public_key: encodeBase64(myKeyPair.publicKey),
      });

    if (error) throw error;
  };

  const markAsSeen = async (storyId: string) => {
    const story = stories.find(s => s.id === storyId);
    if (!story || story.is_mine || story.viewed_at) return;

    const now = new Date().toISOString();
    setStories(prev => prev.map(s => s.id === storyId ? { ...s, viewed_at: now } : s));
    await supabase.from('stories').update({ viewed_at: now }).eq('id', storyId);
  };

  return { stories, loading, addStory, markAsSeen, refresh: () => {} };
}
