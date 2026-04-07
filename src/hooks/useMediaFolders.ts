import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';
import {
  encryptMessage,
  decryptMessage,
  getStoredKeyPair,
  decodeBase64,
  encodeBase64,
} from '../lib/encryption';

export interface MediaFolder {
  id: string;
  created_by: string;
  encrypted_name: string;
  name_nonce: string;
  sender_public_key: string | null;
  cover_message_id: string | null;
  created_at: string;
  // Decrypted fields (client-side only)
  name?: string;
  item_count?: number;
}

export function useMediaFolders() {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loading, setLoading] = useState(true);

  // Use refs to prevent dependency cascading
  const userRef = useRef(user);
  const partnerRef = useRef(partner);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { partnerRef.current = partner; }, [partner]);

  const decryptFolderName = useCallback((folder: MediaFolder): string => {
    try {
      const myKeys = getStoredKeyPair();
      if (!myKeys || !folder.sender_public_key) return '[Encrypted Folder]';

      // Try decrypting with the sender's public key
      const senderPubKey = decodeBase64(folder.sender_public_key);
      return decryptMessage(
        folder.encrypted_name,
        folder.name_nonce,
        senderPubKey,
        myKeys.secretKey
      );
    } catch {
      // If decryption fails with sender key, try partner's current key
      try {
        const myKeys = getStoredKeyPair();
        const currentPartner = partnerRef.current;
        if (!myKeys || !currentPartner?.public_key) return '[Encrypted Folder]';

        return decryptMessage(
          folder.encrypted_name,
          folder.name_nonce,
          decodeBase64(currentPartner.public_key),
          myKeys.secretKey
        );
      } catch {
        return '[Encrypted Folder]';
      }
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    if (!userRef.current || !partnerRef.current) return;
    setLoading(true);

    try {
      // Fetch folders with item counts
      const { data: foldersData, error } = await supabase
        .from('media_folders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch item counts for all folders
      const folderIds = (foldersData || []).map(f => f.id);
      let itemCounts: Record<string, number> = {};

      if (folderIds.length > 0) {
        const { data: countData } = await supabase
          .from('media_folder_items')
          .select('folder_id')
          .in('folder_id', folderIds);

        if (countData) {
          countData.forEach(item => {
            itemCounts[item.folder_id] = (itemCounts[item.folder_id] || 0) + 1;
          });
        }
      }

      const decryptedFolders = (foldersData || []).map(f => ({
        ...f,
        name: decryptFolderName(f),
        item_count: itemCounts[f.id] || 0,
      }));

      setFolders(decryptedFolders);
    } catch (err) {
      console.error('Error fetching folders:', err);
    } finally {
      setLoading(false);
    }
  }, [decryptFolderName]);

  useEffect(() => {
    if (user?.id && partner?.id) {
      fetchFolders();
    }
  }, [user?.id, partner?.id, fetchFolders]);

  const createFolder = useCallback(async (name: string): Promise<string | null> => {
    const currentUser = userRef.current;
    const currentPartner = partnerRef.current;
    if (!currentUser || !currentPartner?.public_key) return null;

    const myKeys = getStoredKeyPair();
    if (!myKeys) return null;

    try {
      const partnerPubKey = decodeBase64(currentPartner.public_key);
      const { ciphertext, nonce } = encryptMessage(name, partnerPubKey, myKeys.secretKey);

      const { data, error } = await supabase
        .from('media_folders')
        .insert({
          created_by: currentUser.id,
          encrypted_name: ciphertext,
          name_nonce: nonce,
          sender_public_key: encodeBase64(myKeys.publicKey),
        })
        .select()
        .single();

      if (error) throw error;

      const newFolder: MediaFolder = {
        ...data,
        name,
        item_count: 0,
      };

      setFolders(prev => [newFolder, ...prev]);
      return data.id;
    } catch (err) {
      console.error('Error creating folder:', err);
      return null;
    }
  }, []);

  const deleteFolder = useCallback(async (folderId: string) => {
    try {
      const { error } = await supabase
        .from('media_folders')
        .delete()
        .eq('id', folderId);

      if (error) throw error;
      setFolders(prev => prev.filter(f => f.id !== folderId));
    } catch (err) {
      console.error('Error deleting folder:', err);
    }
  }, []);

  const addItemsToFolder = useCallback(async (folderId: string, messageIds: string[]) => {
    try {
      const items = messageIds.map(mid => ({
        folder_id: folderId,
        message_id: mid,
      }));

      const { error } = await supabase
        .from('media_folder_items')
        .upsert(items, { onConflict: 'folder_id,message_id', ignoreDuplicates: true });

      if (error) throw error;

      // Update cover if folder has none
      const folder = folders.find(f => f.id === folderId);
      if (folder && !folder.cover_message_id && messageIds.length > 0) {
        await supabase
          .from('media_folders')
          .update({ cover_message_id: messageIds[0] })
          .eq('id', folderId);
      }

      // Refresh counts
      setFolders(prev => prev.map(f =>
        f.id === folderId
          ? { ...f, item_count: (f.item_count || 0) + messageIds.length, cover_message_id: f.cover_message_id || messageIds[0] }
          : f
      ));

      return true;
    } catch (err) {
      console.error('Error adding items to folder:', err);
      return false;
    }
  }, [folders]);

  const removeItemFromFolder = useCallback(async (folderId: string, messageId: string) => {
    try {
      const { error } = await supabase
        .from('media_folder_items')
        .delete()
        .eq('folder_id', folderId)
        .eq('message_id', messageId);

      if (error) throw error;

      setFolders(prev => prev.map(f =>
        f.id === folderId
          ? { ...f, item_count: Math.max(0, (f.item_count || 0) - 1) }
          : f
      ));
    } catch (err) {
      console.error('Error removing item from folder:', err);
    }
  }, []);

  const fetchFolderItems = useCallback(async (folderId: string): Promise<string[]> => {
    try {
      const { data, error } = await supabase
        .from('media_folder_items')
        .select('message_id')
        .eq('folder_id', folderId)
        .order('added_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(d => d.message_id);
    } catch (err) {
      console.error('Error fetching folder items:', err);
      return [];
    }
  }, []);

  const renameFolder = useCallback(async (folderId: string, newName: string) => {
    const currentPartner = partnerRef.current;
    if (!currentPartner?.public_key) return;

    const myKeys = getStoredKeyPair();
    if (!myKeys) return;

    try {
      const partnerPubKey = decodeBase64(currentPartner.public_key);
      const { ciphertext, nonce } = encryptMessage(newName, partnerPubKey, myKeys.secretKey);

      const { error } = await supabase
        .from('media_folders')
        .update({
          encrypted_name: ciphertext,
          name_nonce: nonce,
          sender_public_key: encodeBase64(myKeys.publicKey),
        })
        .eq('id', folderId);

      if (error) throw error;

      setFolders(prev => prev.map(f =>
        f.id === folderId ? { ...f, name: newName, encrypted_name: ciphertext, name_nonce: nonce } : f
      ));
    } catch (err) {
      console.error('Error renaming folder:', err);
    }
  }, []);

  return {
    folders,
    loading,
    createFolder,
    deleteFolder,
    addItemsToFolder,
    removeItemFromFolder,
    fetchFolderItems,
    renameFolder,
    refetch: fetchFolders,
  };
}
