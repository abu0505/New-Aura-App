import type { ChatMessage } from '../hooks/useChat';

export type MessageGroup = ChatMessage[];
export type MessageItem = ChatMessage | MessageGroup;

export const isMessageGroup = (item: MessageItem): item is MessageGroup => Array.isArray(item);

/**
 * Groups consecutive media messages (images/videos) from the same sender 
 * that are sent within 120 seconds of each other and contain no text content.
 */
export function groupMessages(messages: ChatMessage[]): MessageItem[] {
  if (messages.length === 0) return [];

  const grouped: MessageItem[] = [];
  let currentMediaGroup: MessageGroup = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prevMsg = i > 0 ? messages[i - 1] : null;

    // Do not group chunked videos (where type is 'video' but media_url is null)
    // because MediaGridBubble does not support the chunked streaming protocol.
    const isChunkedVideo = (m: ChatMessage) => m.type === 'video' && !m.media_url;
    const isMedia = (msg.type === 'image' || msg.type === 'video' || msg.type === 'gif') 
      && !msg.decrypted_content 
      && !msg.is_deleted_for_everyone
      && !isChunkedVideo(msg);
    
    // Grouping conditions:
    // 1. Current is media
    // 2. We have a previous media message to compare with
    // 3. Same sender
    // 4. Time difference <= 120 seconds
    const shouldGroup = 
      isMedia && 
      prevMsg && 
      prevMsg.sender_id === msg.sender_id && 
      ((prevMsg.type === 'image' || prevMsg.type === 'video' || prevMsg.type === 'gif') 
        && !prevMsg.decrypted_content 
        && !prevMsg.is_deleted_for_everyone
        && !isChunkedVideo(prevMsg)) &&
      (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) <= 120000;

    if (shouldGroup) {
      if (currentMediaGroup.length === 0) {
        // Pop the previous message from 'grouped' and start a group
        const lastAdded = grouped.pop();
        if (lastAdded) {
          if (Array.isArray(lastAdded)) {
            if (lastAdded.length < 10) {
              currentMediaGroup = [...lastAdded, msg];
            } else {
              grouped.push(lastAdded);
              currentMediaGroup = [msg];
            }
          } else {
            currentMediaGroup = [lastAdded, msg];
          }
        } else {
          currentMediaGroup = [msg];
        }
      } else {
        if (currentMediaGroup.length < 10) {
          currentMediaGroup.push(msg);
        } else {
          grouped.push(currentMediaGroup);
          currentMediaGroup = [msg];
        }
      }
      
      // If we are at the end, push the group
      if (i === messages.length - 1) {
        grouped.push(currentMediaGroup);
      }
    } else {
      // If we had a group in progress, push it
      if (currentMediaGroup.length > 0) {
        grouped.push(currentMediaGroup);
        currentMediaGroup = [];
      }
      
      // Push the current message individually (it might start a group next iteration)
      grouped.push(msg);
    }
  }

  return grouped;
}
