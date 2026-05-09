import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';

interface BackgroundCropperProps {
  imageSrc: string;
  onCancel: () => void;
  onSave: (mobileBlob: Blob, desktopBlob: Blob) => void;
}

const getCroppedImg = async (imageSrc: string, pixelCrop: Area): Promise<Blob> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => { image.onload = resolve; });

  const canvas = document.createElement('canvas');
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context');
  }

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas is empty'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', 0.9);
  });
};

export default function BackgroundCropper({ imageSrc, onCancel, onSave }: BackgroundCropperProps) {
  const [activeTab, setActiveTab] = useState<'mobile' | 'desktop'>('mobile');
  const [desktopImageSrc, setDesktopImageSrc] = useState<string | null>(null);

  const [mobileCrop, setMobileCrop] = useState({ x: 0, y: 0 });
  const [mobileZoom, setMobileZoom] = useState(1);
  const [mobileCroppedAreaPixels, setMobileCroppedAreaPixels] = useState<Area | null>(null);

  const [desktopCrop, setDesktopCrop] = useState({ x: 0, y: 0 });
  const [desktopZoom, setDesktopZoom] = useState(1);
  const [desktopCroppedAreaPixels, setDesktopCroppedAreaPixels] = useState<Area | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const handleDesktopImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDesktopImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const onCropCompleteMobile = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setMobileCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const onCropCompleteDesktop = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setDesktopCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!mobileCroppedAreaPixels || !desktopCroppedAreaPixels) return;
    setIsProcessing(true);
    try {
      const mobileBlob = await getCroppedImg(imageSrc, mobileCroppedAreaPixels);
      const desktopBlob = await getCroppedImg(desktopImageSrc || imageSrc, desktopCroppedAreaPixels);
      onSave(mobileBlob, desktopBlob);
    } catch (e) {
      console.error(e);
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 lg:p-10 animate-fade-in">
      <div className="bg-[var(--bg-secondary)] border border-white/10 rounded-3xl w-full max-w-4xl flex flex-col overflow-hidden shadow-2xl relative">
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b border-white/5 p-2 bg-black/20">
          <div className="flex items-center gap-2 px-2">
            <button
              onClick={() => setActiveTab('mobile')}
              className={`px-4 py-2 rounded-xl text-sm font-label uppercase tracking-widest transition-all ${
                activeTab === 'mobile' 
                  ? 'bg-[var(--gold)] text-black font-bold shadow-[0_0_15px_rgba(201,169,110,0.4)]' 
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              Mobile View
            </button>
            <button
              onClick={() => setActiveTab('desktop')}
              className={`px-4 py-2 rounded-xl text-sm font-label uppercase tracking-widest transition-all ${
                activeTab === 'desktop' 
                  ? 'bg-[var(--gold)] text-black font-bold shadow-[0_0_15px_rgba(201,169,110,0.4)]' 
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              Desktop View
            </button>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors mr-2"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Cropper Area */}
        <div className="relative w-full h-[50vh] lg:h-[60vh] bg-black/50">
          {activeTab === 'mobile' ? (
            <Cropper
              image={imageSrc}
              crop={mobileCrop}
              zoom={mobileZoom}
              aspect={9 / 16}
              onCropChange={setMobileCrop}
              onZoomChange={setMobileZoom}
              onCropComplete={onCropCompleteMobile}
            />
          ) : (
            <Cropper
              image={desktopImageSrc || imageSrc}
              crop={desktopCrop}
              zoom={desktopZoom}
              aspect={16 / 9}
              onCropChange={setDesktopCrop}
              onZoomChange={setDesktopZoom}
              onCropComplete={onCropCompleteDesktop}
            />
          )}
        </div>

        {/* Instructions & Controls */}
        <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6 bg-black/40">
          <div className="flex-1">
            <h4 className="text-[var(--gold)] font-serif italic text-lg mb-1">
              {activeTab === 'mobile' ? 'Mobile Aspect Ratio' : 'Desktop Aspect Ratio'}
            </h4>
            <p className="text-white/50 text-xs font-label uppercase tracking-wider leading-relaxed">
              Drag and zoom the image to set how the background will appear on {activeTab === 'mobile' ? 'mobile devices' : 'desktop screens'}.
              {activeTab === 'mobile' && ' Remember to set the desktop view before saving!'}
            </p>
            {activeTab === 'desktop' && (
              <div className="mt-4 flex items-center gap-4">
                <label className="cursor-pointer px-4 py-2 rounded-lg border border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/10 transition-colors text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">image</span>
                  Change Image for Desktop
                  <input type="file" accept="image/*" className="hidden" onChange={handleDesktopImageUpload} />
                </label>
                {desktopImageSrc && (
                  <button 
                    onClick={() => setDesktopImageSrc(null)}
                    className="text-white/40 hover:text-red-400 text-xs font-label uppercase tracking-widest transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                    Use Same Image
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button 
              onClick={onCancel}
              className="flex-1 md:flex-none px-6 py-3 rounded-full border border-white/10 text-white hover:bg-white/5 transition-colors font-label text-xs uppercase tracking-widest"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="flex-1 md:flex-none px-8 py-3 rounded-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-light)] text-black font-bold shadow-lg shadow-[var(--gold)]/20 hover:shadow-[var(--gold)]/40 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 font-label text-xs uppercase tracking-widest"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <span className="material-symbols-outlined animate-spin text-sm">sync</span>
              ) : (
                <span className="material-symbols-outlined text-sm">check</span>
              )}
              {isProcessing ? 'Processing...' : 'Save Crops'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
