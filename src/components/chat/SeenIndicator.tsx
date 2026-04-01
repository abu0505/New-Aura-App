import { useState, useEffect } from 'react';
import { formatDistanceToNow, differenceInSeconds } from 'date-fns';

interface SeenIndicatorProps {
  timestamp: string;
}

export function SeenIndicator({ timestamp }: SeenIndicatorProps) {
  const [displayText, setDisplayText] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const date = new Date(timestamp);
      const diffSeconds = differenceInSeconds(new Date(), date);

      if (diffSeconds < 30) {
        setDisplayText('Seen just now');
      } else {
        setDisplayText(`Seen ${formatDistanceToNow(date, { addSuffix: true })}`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 10000); // Update every 10s for accuracy

    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <div className="flex justify-end px-6 py-1 pb-4 animate-fade-in">
      <span className="text-[11px] font-medium text-[#e6c487]/60 tracking-tight italic">
        {displayText}
      </span>
    </div>
  );
}
