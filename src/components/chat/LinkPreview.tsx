import { useState, useEffect } from 'react';

interface LinkPreviewProps {
  url: string;
}

export default function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
        const result = await response.json();
        if (result.status === 'success') {
          setData(result.data);
        }
      } catch (e) {
        
      } finally {
        setLoading(false);
      }
    };
    fetchMetadata();
  }, [url]);

  if (loading) {
    return (
      <div className="mt-2 block w-full h-24 rounded-xl border border-white/5 bg-white/5 animate-pulse" />
    );
  }

  if (!data || (!data.image && !data.title)) return null;

  return (
    <a 
      href={url} 
      target="_blank" 
      rel="noopener noreferrer"
      className="mt-2 block rounded-xl overflow-hidden border border-[var(--gold)]/20 bg-black/20 hover:bg-black/30 transition-colors cursor-pointer"
    >
      {data.image && (
        <div className="relative w-full h-32 bg-[#13131e]">
          <img 
            src={data.image.url} 
            alt={data.title || "Link preview"} 
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div className="p-3">
        <h4 className="text-sm font-semibold text-[#E4E1ED] line-clamp-1">{data.title || url}</h4>
        {data.description && (
          <p className="text-xs text-[#8A8799] mt-1 line-clamp-2 leading-relaxed">{data.description}</p>
        )}
        <div className="text-[10px] text-[#A89F91] mt-2 uppercase tracking-wide font-medium">
          {new URL(url).hostname.replace('www.', '')}
        </div>
      </div>
    </a>
  );
}
