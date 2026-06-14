import type { CollageLayoutConfig } from './CollageBuilder';

interface CustomScrapbookLayoutProps {
  config: CollageLayoutConfig;
  images: Array<{ id: string; decryptedUrl: string }>;
  onImageClick: (i: number) => void;
}

export default function CustomScrapbookLayout({
  config,
  images,
  onImageClick,
}: CustomScrapbookLayoutProps) {
  const { gridSize, frames } = config;

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
        gridTemplateRows: `repeat(${gridSize}, 1fr)`,
        background: '#f4f0e6',
      }}
    >
      {frames.map((frame, idx) => {
        const image = images[idx];
        return (
          <div
            key={frame.id}
            onClick={() => image && onImageClick(idx)}
            style={{
              gridColumn: `${frame.colStart} / ${frame.colEnd}`,
              gridRow: `${frame.rowStart} / ${frame.rowEnd}`,
              backgroundColor: '#ffffff',
              boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: '0.2rem',
              overflow: 'hidden',
            }}
            className={`z-10 transition-all duration-300 ${image ? 'cursor-zoom-in hover:scale-[1.02] hover:z-30 hover:shadow-2xl' : ''}`}
          >
            {image ? (
              <img
                src={image.decryptedUrl}
                className="w-full h-full object-cover brightness-[98%] contrast-[102%]"
                alt=""
              />
            ) : (
              // Placeholder for empty frame (no image available)
              <div
                className="w-full h-full flex items-center justify-center"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, rgba(154,134,86,0.12) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(154,134,86,0.12) 1px, transparent 1px)
                  `,
                  backgroundSize: '20% 20%',
                }}
              >
                <span className="material-symbols-outlined text-2xl text-[#9a8656]/30">
                  image
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
