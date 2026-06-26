import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import Cropper from 'react-easy-crop';
import type { Point, Area } from 'react-easy-crop';
import getCroppedImg from '../../utils/cropImage';
import { X, Check, Sliders } from 'lucide-react';

interface MediaCropperModalProps {
  mediaSrc: string;
  mediaType: 'image' | 'video';
  initialAspect?: string;
  onCropComplete: (croppedFile: File | null, aspect: string) => void;
  onCancel: () => void;
}

const PRESET_RATIOS = [
  { label: '9:16', value: 9 / 16, name: 'Vertical' },
  { label: '2:3', value: 2 / 3, name: 'Portrait' },
  { label: '4:5', value: 4 / 5, name: 'Feed' },
  { label: '1:1', value: 1 / 1, name: 'Square' },
  { label: '16:9', value: 16 / 9, name: 'Landscape' },
  { label: '21:9', value: 21 / 9, name: 'Cinematic' },
];

export default function MediaCropperModal({
  mediaSrc,
  mediaType,
  initialAspect = '9:16',
  onCropComplete,
  onCancel,
}: MediaCropperModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedRatio, setSelectedRatio] = useState(() => {
    const found = PRESET_RATIOS.find((r) => r.label === initialAspect);
    return found || PRESET_RATIOS[0];
  });
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropCompleteHandler = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (isProcessing) return;

    if (mediaType === 'image') {
      if (!croppedAreaPixels) return;
      setIsProcessing(true);
      try {
        const croppedFile = await getCroppedImg(mediaSrc, croppedAreaPixels);
        if (croppedFile) {
          onCropComplete(croppedFile, selectedRatio.label);
        } else {
          throw new Error('Could not crop image');
        }
      } catch (e: any) {
        console.error('[MediaCropperModal] Crop error:', e);
        toast.error('Error cropping image', {
          description: e.message || 'Unknown error occurred',
        });
      } finally {
        setIsProcessing(false);
      }
    } else {
      // For video, we don't modify the file bytes, we just apply the aspect ratio visually
      onCropComplete(null, selectedRatio.label);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 md:p-8 backdrop-blur-md">
      <div className="relative w-full max-w-3xl h-[85vh] flex flex-col bg-[var(--bg-secondary)] rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 z-10 bg-[var(--bg-secondary)]">
          <button 
            onClick={onCancel}
            disabled={isProcessing}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white transition-all active:scale-95"
          >
            <X size={20} />
          </button>
          
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[var(--gold)]" />
            <h2 className="font-label tracking-widest text-[11px] uppercase text-white/70">
              Crop {mediaType === 'image' ? 'Photo' : 'Video'} Reel
            </h2>
          </div>
          
          <button 
            onClick={handleSave}
            disabled={isProcessing}
            className={`px-5 py-2.5 rounded-full font-label tracking-wide text-[11px] uppercase transition-all active:scale-95 flex items-center gap-1.5 ${
              isProcessing 
                ? 'bg-[var(--gold)]/50 text-black/50 cursor-not-allowed' 
                : 'bg-[var(--gold)] text-black hover:bg-[var(--gold)]/90'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {isProcessing ? 'Applying...' : 'Apply Crop'}
          </button>
        </div>

        {/* Cropper Container */}
        <div className="relative flex-1 bg-black overflow-hidden">
          {mediaType === 'image' ? (
            <Cropper
              image={mediaSrc}
              crop={crop}
              zoom={zoom}
              aspect={selectedRatio.value}
              onCropChange={setCrop}
              onCropComplete={onCropCompleteHandler}
              onZoomChange={setZoom}
              showGrid={true}
            />
          ) : (
            <Cropper
              video={mediaSrc}
              crop={crop}
              zoom={zoom}
              aspect={selectedRatio.value}
              onCropChange={setCrop}
              onCropComplete={onCropCompleteHandler}
              onZoomChange={setZoom}
              showGrid={true}
            />
          )}
        </div>

        {/* Bottom Panel */}
        <div className="p-6 bg-[var(--bg-secondary)] border-t border-white/10 z-10 space-y-6">
          
          {/* Zoom Slider */}
          <div className="flex items-center gap-4">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Zoom</span>
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--gold)] outline-none"
            />
            <span className="text-xs font-mono text-white/60">{zoom.toFixed(1)}x</span>
          </div>

          {/* Aspect Ratios Selection */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40 block">Select Aspect Ratio</span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PRESET_RATIOS.map((ratio) => {
                const isActive = selectedRatio.label === ratio.label;
                return (
                  <button
                    key={ratio.label}
                    onClick={() => setSelectedRatio(ratio)}
                    className={`py-2.5 px-3 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all ${
                      isActive
                        ? 'border-[var(--gold)] bg-[var(--gold)]/10 text-white'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05] text-white/60 hover:text-white/90'
                    }`}
                  >
                    <span className="text-xs font-bold font-mono">{ratio.label}</span>
                    <span className="text-[9px] uppercase tracking-wider opacity-60 font-semibold">{ratio.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          
        </div>

      </div>
    </div>
  );
}
