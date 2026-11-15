import React, { useState, useRef, useEffect } from 'react';
import { Cropper } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';

const ASPECT_RATIOS = [
  { label: 'Free', value: undefined },
  { label: 'Square (1:1)', value: 1 / 1 },
  { label: 'Portrait (4:5)', value: 4 / 5 },
  { label: 'Widescreen (16:9)', value: 16 / 9 },
];

export default function ImageCropModal({ 
  isOpen, 
  image, 
  onCancel, 
  onCropComplete,
  queueProgress, // Optional: { current: number, total: number, fileName?: string }
  onSkip,        // Optional: () => void
  onCancelQueue  // Optional: () => void
}) {
  const cropperRef = useRef(null);
  const modalContainerRef = useRef(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [mode, setMode] = useState('cover'); // 'cover' or 'content'
  const [isProcessing, setIsProcessing] = useState(false);

  const queueIndex = queueProgress?.current;

  // Bring cropper smoothly into view whenever opened or queue item advances
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      if (modalContainerRef.current) {
        modalContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      document.body.style.overflow = '';
      setIsProcessing(false);
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, queueIndex]);

  const handleApplyCrop = async () => {
    if (!cropperRef.current) return;
    setIsProcessing(true);
    try {
      const canvas = cropperRef.current.getCanvas();
      if (canvas) {
        canvas.toBlob((blob) => {
          if (blob) {
            blob.preserveDimensions = false; // It was cropped, dimensions changed
            onCropComplete(blob);
          } else {
            alert('Failed to generate cropped image. Please retry.');
          }
          setIsProcessing(false);
        }, 'image/webp', 0.95);
      } else {
        setIsProcessing(false);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to crop image. Please try again.');
      setIsProcessing(false);
    }
  };

  const handleUseOriginal = async () => {
    setIsProcessing(true);
    try {
      // Convert Data URL or URL to Blob
      const response = await fetch(image);
      const blob = await response.blob();
      blob.preserveDimensions = true; // Flag for downstream processor
      onCropComplete(blob);
    } catch (e) {
      console.error(e);
      alert('Failed to process original image.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen || !image) return null;

  const isQueue = queueProgress && queueProgress.total > 1;
  const isLastInQueue = queueProgress ? queueProgress.current === queueProgress.total : true;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6 bg-background/95 backdrop-blur-xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Image Cropping Interface"
      >
        <motion.div
          ref={modalContainerRef}
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          className="relative w-full max-w-5xl bg-card-bg border border-white/10 rounded-[28px] md:rounded-[32px] overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.95)] flex flex-col max-h-[92vh] my-auto"
        >
          {/* Header */}
          <div className="flex-shrink-0 p-4 md:p-6 lg:p-8 border-b border-white/5 flex justify-between items-center bg-card-bg/70 backdrop-blur-md">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-label text-[10px] tracking-[0.3em] uppercase text-accent font-semibold">
                  {isQueue ? 'Sequential Crop Workflow' : 'Image Optimization'}
                </span>
                {isQueue && (
                  <span className="bg-accent/15 border border-accent/30 text-accent font-headline text-[10px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full">
                    Image {queueProgress.current} of {queueProgress.total}
                  </span>
                )}
              </div>
              <h2 className="font-headline font-bold text-lg md:text-xl uppercase tracking-wider text-primary-text">
                Prepare Asset
              </h2>
              {queueProgress?.fileName && (
                <p className="text-[11px] font-body text-primary-text/40 truncate max-w-xs md:max-w-md mt-0.5">
                  File: {queueProgress.fileName}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isQueue && onCancelQueue && (
                <button
                  type="button"
                  onClick={onCancelQueue}
                  className="hidden sm:inline-flex text-[10px] font-headline font-bold uppercase tracking-wider text-primary-text/50 hover:text-red-400 px-3 py-1.5 rounded-lg border border-white/10 hover:border-red-400/30 transition-all"
                  title="Cancel remaining queue without losing previously completed crops"
                >
                  Exit Queue
                </button>
              )}
              <button 
                type="button"
                onClick={onCancel}
                className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-primary-text/40 hover:text-red-400 hover:bg-white/10 transition-all active:scale-90"
                aria-label="Close cropping dialog"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Sequential Queue Progress Bar */}
          {isQueue && (
            <div className="w-full bg-white/5 h-1">
              <div 
                className="bg-accent h-1 transition-all duration-300 ease-out"
                style={{ width: `${(queueProgress.current / queueProgress.total) * 100}%` }}
              />
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
            {/* Mode Selector */}
            <div className="flex justify-center p-3 sm:p-4 bg-[#0a0a0a] border-b border-white/5">
              <div className="bg-white/5 rounded-full p-1 flex">
                <button
                  type="button"
                  onClick={() => setMode('cover')}
                  className={`px-5 sm:px-6 py-2 rounded-full font-headline text-[10px] uppercase tracking-widest font-bold transition-all ${
                    mode === 'cover' ? 'bg-accent text-on-accent shadow-md' : 'text-primary-text/40 hover:text-primary-text'
                  }`}
                >
                  Crop Image
                </button>
                <button
                  type="button"
                  onClick={() => setMode('content')}
                  className={`px-5 sm:px-6 py-2 rounded-full font-headline text-[10px] uppercase tracking-widest font-bold transition-all ${
                    mode === 'content' ? 'bg-accent text-on-accent shadow-md' : 'text-primary-text/40 hover:text-primary-text'
                  }`}
                >
                  Preserve Original
                </button>
              </div>
            </div>

            {mode === 'cover' ? (
              <>
                <div className="relative h-[240px] sm:h-[350px] md:h-[430px] flex-shrink-0 bg-[#070402] border-b border-white/5">
                  <Cropper
                    ref={cropperRef}
                    src={image}
                    className="cropper-container h-full w-full"
                    stencilProps={{
                      aspectRatio: aspect,
                    }}
                    backgroundWrapperProps={{
                      scaleImage: true
                    }}
                  />
                </div>

                {/* Aspect Controls Section */}
                <div className="p-4 md:p-6 flex justify-center bg-card-bg/40">
                  <div className="space-y-3 max-w-2xl w-full">
                    <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/40 block text-center">
                      Choose Framing Ratio
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {ASPECT_RATIOS.map((arr, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setAspect(arr.value)}
                          className={`py-2.5 px-2 rounded-xl text-[10px] font-headline font-bold uppercase tracking-wider transition-all border ${
                            aspect === arr.value 
                              ? 'bg-accent text-on-accent border-accent shadow-lg shadow-accent/20' 
                              : 'bg-white/5 border-white/5 text-primary-text/50 hover:bg-white/10 hover:text-primary-text'
                          }`}
                        >
                          {arr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 bg-[#0a0a0a] border-b border-white/5 min-h-[300px] md:min-h-[400px] gap-6 text-center">
                <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                  <span className="material-symbols-outlined text-3xl">aspect_ratio</span>
                </div>
                <div className="max-w-md space-y-2">
                  <h3 className="font-headline text-lg font-bold uppercase tracking-wider text-primary-text">
                    Keep Original Proportions
                  </h3>
                  <p className="font-body text-xs md:text-sm text-primary-text/60 leading-relaxed">
                    Bypasses canvas cropping and preserves the designer's native aspect ratio, dimensions, and framing for this image.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 p-4 sm:p-6 md:p-8 border-t border-white/5 bg-card-bg/80 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              {/* Left secondary actions */}
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isProcessing}
                  className="font-headline text-[11px] font-bold uppercase tracking-widest text-primary-text/40 hover:text-primary-text transition-colors disabled:opacity-30 py-2.5 px-4"
                >
                  {isQueue ? 'Cancel Current' : 'Discard'}
                </button>

                {isQueue && onSkip && (
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={isProcessing}
                    className="font-headline text-[11px] font-bold uppercase tracking-widest text-accent/70 hover:text-accent transition-colors disabled:opacity-30 py-2.5 px-4 rounded-xl border border-accent/20 hover:border-accent/40"
                    title="Skip this image without saving and move to next"
                  >
                    Skip Image
                  </button>
                )}
              </div>

              {/* Right primary actions */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                {mode === 'cover' ? (
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    disabled={isProcessing}
                    className="w-full sm:w-auto bg-accent text-on-accent px-8 py-3.5 rounded-full font-headline font-bold text-xs uppercase tracking-widest shadow-xl shadow-accent/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-on-accent border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[1.1rem]">crop</span>
                        {isQueue ? (isLastInQueue ? 'Crop & Finish' : 'Crop & Next') : 'Apply Crop'}
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUseOriginal}
                    disabled={isProcessing}
                    className="w-full sm:w-auto bg-primary-text text-background px-8 py-3.5 rounded-full font-headline font-bold text-xs uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[1.1rem]">check_circle</span>
                        {isQueue ? (isLastInQueue ? 'Use Original & Finish' : 'Use Original & Next') : 'Use Original'}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
