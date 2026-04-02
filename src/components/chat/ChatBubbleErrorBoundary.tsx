import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  messageId?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Wraps individual ChatBubble instances so that if a single message throws
 * during render (e.g. a decryption edge-case or a Framer Motion issue),
 * only that bubble is silently hidden instead of the entire chat screen
 * going blank.
 */
export class ChatBubbleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      `[ChatBubble] Render error for message ${this.props.messageId ?? 'unknown'}:`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.hasError) {
      // Silently drop the broken bubble — better than a blank screen
      return null;
    }
    return this.props.children;
  }
}
