import { useMediaFoldersContext } from '../contexts/MediaFoldersContext';
export type { MediaFolder } from '../contexts/MediaFoldersContext';

export function useMediaFolders() {
  return useMediaFoldersContext();
}
