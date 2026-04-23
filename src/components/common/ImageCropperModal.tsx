import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Point, Area } from 'react-easy-crop';
import getCroppedImg from '../../utils/cropImage';

interface ImageCropperModalProps {
  imageSrc: string;
  onCropComplete: (croppedFile: File) => void;
  onCancel: () => void;
}

export default function ImageCropperModal({ imageSrc, onCropComplete, onCancel }: ImageCropperModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropCompleteHandler = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels || isProcessing) return;
    
    setIsProcessing(true);
    try {
      const croppedFile = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (croppedFile) {
        onCropComplete(croppedFile);
      }
    } catch (e: any) {
      
      alert('Error cropping image: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 md:p-8 backdrop-blur-md">
      <div className="relative w-full max-w-2xl h-[80vh] flex flex-col bg-[var(--bg-secondary)] rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 z-10 bg-[var(--bg-secondary)]">
          <button 
            onClick={onCancel}
            disabled={isProcessing}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white transition-colors"
          >
            <span className="material-symbols-outlined shrink-0 text-[20px]">close</span>
          </button>
          
          <h2 className="font-label tracking-widest text-[11px] uppercase text-white/70">Adjust Avatar</h2>
          
          <button 
            onClick={handleSave}
            disabled={isProcessing}
            className={`px-4 py-2 rounded-full font-label tracking-wide text-[11px] uppercase transition-colors ${
              isProcessing 
                ? 'bg-[var(--gold)]/50 text-black/50 cursor-not-allowed' 
                : 'bg-[var(--gold)] text-black hover:bg-[var(--gold)]/90'
            }`}
          >
            {isProcessing ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Cropper Container */}
        <div className="relative flex-1 bg-black overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1} // 1:1 Aspect Ratio for Avatar
            onCropChange={setCrop}
            onCropComplete={onCropCompleteHandler}
            onZoomChange={setZoom}
            cropShape="round"
            showGrid={false}
          />
        </div>

        {/* Controls */}
        <div className="p-6 bg-[var(--bg-secondary)] border-t border-white/10 z-10 flex items-center gap-4">
          <span className="material-symbols-outlined text-white/50 shrink-0 text-[18px]">zoom_out</span>
          <input
            type="range"
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            aria-labelledby="Zoom"
            onChange={(e) => {
              setZoom(Number(e.target.value));
            }}
            className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--gold)] outline-none"
          />
          <span className="material-symbols-outlined text-white/50 shrink-0 text-[18px]">zoom_in</span>
        </div>

      </div>
    </div>
  );
}
