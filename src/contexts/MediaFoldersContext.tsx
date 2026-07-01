import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { usePartner, type PartnerProfile } from '../hooks/usePartner';
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
  last_item_added_at?: string | null;
}

interface MediaFoldersContextType {
  folders: MediaFolder[];
  loading: boolean;
  createFolder: (name: string) => Promise<string | null>;
  deleteFolder: (folderId: string) => Promise<void>;
  addItemsToFolder: (folderId: string, messageIds: string[]) => Promise<boolean>;
  removeItemFromFolder: (folderId: string, messageId: string) => Promise<void>;
  fetchFolderItems: (folderId: string) => Promise<string[]>;
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const MediaFoldersContext = createContext<MediaFoldersContextType | undefined>(undefined);

export function MediaFoldersProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { partner } = usePartner();
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [loading, setLoading] = useState(true);

  // Use refs to prevent dependency cascading
  const userRef = useRef(user);
  const partnerRef = useRef(partner);
  const foldersRef = useRef(folders);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { partnerRef.current = partner; }, [partner]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const decryptFolderName = useCallback((folder: MediaFolder, currentPartner: PartnerProfile | null): string => {
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

  const sortFolders = useCallback((foldersList: MediaFolder[]): MediaFolder[] => {
    return [...foldersList].sort((a, b) => {
      const timeA = new Date(a.last_item_added_at || a.created_at).getTime();
      const timeB = new Date(b.last_item_added_at || b.created_at).getTime();
      return timeB - timeA;
    });
  }, []);

  const fetchFolders = useCallback(async (currUser = userRef.current, currPartner = partnerRef.current) => {
    if (!currUser || !currPartner) return;
    setLoading(true);

    try {
      // Fetch folders
      const { data: foldersData, error } = await supabase
        .from('media_folders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch item counts and last item added times for all folders
      const folderIds = (foldersData || []).map(f => f.id);
      let itemCounts: Record<string, number> = {};
      let maxAddedAt: Record<string, string> = {};

      if (folderIds.length > 0) {
        const { data: countData } = await supabase
          .from('media_folder_items')
          .select('folder_id, added_at')
          .in('folder_id', folderIds);

        if (countData) {
          countData.forEach(item => {
            itemCounts[item.folder_id] = (itemCounts[item.folder_id] || 0) + 1;
            
            const currentMax = maxAddedAt[item.folder_id];
            if (!currentMax || new Date(item.added_at) > new Date(currentMax)) {
              maxAddedAt[item.folder_id] = item.added_at;
            }
          });
        }
      }

      const decryptedFolders = (foldersData || []).map(f => ({
        ...f,
        name: decryptFolderName(f, currPartner),
        item_count: itemCounts[f.id] || 0,
        last_item_added_at: maxAddedAt[f.id] || null,
      }));

      setFolders(sortFolders(decryptedFolders));
    } catch (err) {
      // Error fetching folders
    } finally {
      setLoading(false);
    }
  }, [decryptFolderName, sortFolders]);

  useEffect(() => {
    if (user?.id && partner?.id) {
      fetchFolders(user, partner);
    }
  }, [user?.id, partner?.id, fetchFolders]);

  // Re-decrypt folder names if partner key becomes available
  useEffect(() => {
    if (!partner?.public_key || folders.length === 0) return;
    
    const hasEncrypted = folders.some(f => f.name === '[Encrypted Folder]');
    if (hasEncrypted) {
      setFolders(prev => prev.map(f => {
        if (f.name === '[Encrypted Folder]') {
          const decryptedName = decryptFolderName(f, partner);
          if (decryptedName !== '[Encrypted Folder]') {
            return {
              ...f,
              name: decryptedName
            };
          }
        }
        return f;
      }));
    }
  }, [partner?.public_key, folders, decryptFolderName]);

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
        last_item_added_at: null,
      };

      setFolders(prev => sortFolders([newFolder, ...prev]));
      return data.id;
    } catch (err) {
      return null;
    }
  }, [sortFolders]);

  const deleteFolder = useCallback(async (folderId: string) => {
    try {
      const { error } = await supabase
        .from('media_folders')
        .delete()
        .eq('id', folderId);

      if (error) throw error;
      setFolders(prev => prev.filter(f => f.id !== folderId));
    } catch (err) {
      // Error deleting folder
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
      const folder = foldersRef.current.find(f => f.id === folderId);
      if (folder && !folder.cover_message_id && messageIds.length > 0) {
        await supabase
          .from('media_folders')
          .update({ cover_message_id: messageIds[0] })
          .eq('id', folderId);
      }

      // Refresh counts and sort
      setFolders(prev => {
        const updated = prev.map(f =>
          f.id === folderId
            ? { 
                ...f, 
                item_count: (f.item_count || 0) + messageIds.length, 
                cover_message_id: f.cover_message_id || messageIds[0],
                last_item_added_at: new Date().toISOString()
              }
            : f
        );
        return sortFolders(updated);
      });

      return true;
    } catch (err) {
      return false;
    }
  }, [sortFolders]);

  const removeItemFromFolder = useCallback(async (folderId: string, messageId: string) => {
    try {
      const { error } = await supabase
        .from('media_folder_items')
        .delete()
        .eq('folder_id', folderId)
        .eq('message_id', messageId);

      if (error) throw error;

      setFolders(prev => prev.map(f => {
        if (f.id === folderId) {
          const isCover = f.cover_message_id === messageId;
          if (isCover) {
            // Reset cover_message_id in supabase database
            supabase
              .from('media_folders')
              .update({ cover_message_id: null })
              .eq('id', folderId)
              .then(); // fire-and-forget
            return {
              ...f,
              item_count: Math.max(0, (f.item_count || 0) - 1),
              cover_message_id: null
            };
          }
          return { ...f, item_count: Math.max(0, (f.item_count || 0) - 1) };
        }
        return f;
      }));
    } catch (err) {
      // Error removing item from folder
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
      // Error renaming folder
    }
  }, []);

  // ═══ PERF: Memoize context value ═══
  const value = useMemo(() => ({
    folders,
    loading,
    createFolder,
    deleteFolder,
    addItemsToFolder,
    removeItemFromFolder,
    fetchFolderItems,
    renameFolder,
    refetch: fetchFolders,
  }), [folders, loading, createFolder, deleteFolder, addItemsToFolder, removeItemFromFolder, fetchFolderItems, renameFolder, fetchFolders]);

  return (
    <MediaFoldersContext.Provider value={value}>
      {children}
    </MediaFoldersContext.Provider>
  );
}

export function useMediaFoldersContext() {
  const context = useContext(MediaFoldersContext);
  if (context === undefined) {
    throw new Error('useMediaFoldersContext must be used within a MediaFoldersProvider');
  }
  return context;
}
