import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createProject, updateProject, recordImageFingerprint } from '../firebase/services/projectService';
import { uploadFile } from '../firebase/services/storageService';
import ImageCropModal from './ImageCropModal';
import { processImageForWeb } from '../utils/imageProcessor';
import { saveDraft, getDraft, clearDraft, hasDraft } from '../utils/draftStorage';

const MAX_ADDITIONAL_IMAGES = 4;

export default function ProjectModal({ isOpen, onClose, onSuccess, initialData }) {
  // Form text data
  const [formData, setFormData] = useState({ 
    title: '', 
    subtitle: '',
    philosophy: '', 
    splineUrl: '',
    location: '',
    scale: '',
    completion: '',
    materials: ''
  });

  // Featured Image State: { blob: Blob|null, previewUrl: string, name: string, isCropped: boolean, existingUrl: string|null }
  const [featuredImage, setFeaturedImage] = useState(null);

  // Additional Images State: Array of { id: string, blob: Blob|null, previewUrl: string, name: string, isCropped: boolean, existingUrl: string|null, title: string, desc: string }
  const [additionalImages, setAdditionalImages] = useState([]);

  // Modal / submission status
  const [status, setStatus] = useState({ state: 'idle', message: '' });

  // Confirmation Dialog States
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [showStartFreshConfirm, setShowStartFreshConfirm] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);

  // Cropping Queue State: array of items to crop sequentially
  // Item: { id, type: 'featured' | 'additional_new' | 'additional_replace' | 'additional_recrop', targetId?: string, dataUrl: string, name: string, originalBlob?: Blob }
  const [cropQueue, setCropQueue] = useState([]);
  const [currentCropIndex, setCurrentCropIndex] = useState(0);

  // Draft Key
  const draftKey = initialData?.id ? `project_draft_edit_${initialData.id}` : 'project_draft_new';
  const isRestoringRef = useRef(false);

  // Track if user has modified anything
  const isFormDirty = useCallback(() => {
    if (initialData) {
      const titleChanged = formData.title !== (initialData.title || '');
      const subChanged = formData.subtitle !== (initialData.subtitle || '');
      const philChanged = formData.philosophy !== (initialData.philosophy || initialData.description || '');
      const splineChanged = formData.splineUrl !== (initialData.splineUrl || '');
      const locChanged = formData.location !== (initialData.location || '');
      const scaleChanged = formData.scale !== (initialData.scale || '');
      const compChanged = formData.completion !== (initialData.completion || '');
      const matChanged = formData.materials !== (initialData.materials || '');
      const featuredNewBlob = !!featuredImage?.blob;
      const additionalChanged = additionalImages.some(img => !!img.blob);
      return titleChanged || subChanged || philChanged || splineChanged || locChanged || scaleChanged || compChanged || matChanged || featuredNewBlob || additionalChanged;
    } else {
      const hasText = Object.values(formData).some(val => typeof val === 'string' && val.trim().length > 0);
      const hasFeatured = !!featuredImage;
      const hasAdditional = additionalImages.length > 0;
      return hasText || hasFeatured || hasAdditional;
    }
  }, [formData, featuredImage, additionalImages, initialData]);

  // Handle initialization and draft check
  useEffect(() => {
    if (!isOpen) {
      setShowUnsavedConfirm(false);
      setShowRestorePrompt(false);
      setShowStartFreshConfirm(false);
      setPendingDraft(null);
      setCropQueue([]);
      setCurrentCropIndex(0);
      return;
    }

    const checkDraftAndInitialize = async () => {
      if (initialData) {
        // Editing existing project
        setFormData({
          title: initialData.title || '',
          subtitle: initialData.subtitle || '',
          philosophy: initialData.philosophy || initialData.description || '',
          splineUrl: initialData.splineUrl || '',
          location: initialData.location || '',
          scale: initialData.scale || '',
          completion: initialData.completion || '',
          materials: initialData.materials || '',
        });

        const initialFeatured = initialData.images?.[0] || initialData.mainImage;
        if (initialFeatured) {
          const featUrl = typeof initialFeatured === 'string' ? initialFeatured : initialFeatured.url;
          setFeaturedImage({
            blob: null,
            previewUrl: featUrl,
            name: 'Featured',
            isCropped: true,
            existingUrl: featUrl
          });
        } else {
          setFeaturedImage(null);
        }

        const initialAddons = (initialData.images?.slice(1) || []).map((img, idx) => {
          const url = typeof img === 'string' ? img : img.url;
          const metaTitle = typeof img === 'string' ? '' : (img.title || '');
          const metaDesc = typeof img === 'string' ? '' : (img.description || img.desc || '');
          return {
            id: `existing_${idx}_${Date.now()}`,
            blob: null,
            previewUrl: url,
            name: `Asset ${idx + 1}`,
            isCropped: true,
            existingUrl: url,
            title: metaTitle,
            desc: metaDesc
          };
        });
        setAdditionalImages(initialAddons);
        setStatus({ state: 'idle', message: '' });
      } else {
        // New project mode - check if saved draft exists
        const draftExists = await hasDraft('project_draft_new');
        if (draftExists) {
          const savedDraft = await getDraft('project_draft_new');
          if (savedDraft) {
            setPendingDraft(savedDraft);
            setShowRestorePrompt(true);
            return;
          }
        }

        // No draft: fresh form
        resetFormToBlank();
      }
    };

    checkDraftAndInitialize();
  }, [isOpen, initialData]);

  const resetFormToBlank = () => {
    setFormData({ 
      title: '', 
      subtitle: '',
      philosophy: '', 
      splineUrl: '',
      location: '',
      scale: '',
      completion: '',
      materials: ''
    });
    setFeaturedImage(null);
    setAdditionalImages([]);
    setStatus({ state: 'idle', message: '' });
  };

  // Restore draft handler
  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    isRestoringRef.current = true;

    setFormData({
      title: pendingDraft.formData?.title || '',
      subtitle: pendingDraft.formData?.subtitle || '',
      philosophy: pendingDraft.formData?.philosophy || '',
      splineUrl: pendingDraft.formData?.splineUrl || '',
      location: pendingDraft.formData?.location || '',
      scale: pendingDraft.formData?.scale || '',
      completion: pendingDraft.formData?.completion || '',
      materials: pendingDraft.formData?.materials || ''
    });

    if (pendingDraft.featuredImage) {
      const featBlob = pendingDraft.featuredImage.blob;
      const featUrl = featBlob ? URL.createObjectURL(featBlob) : (pendingDraft.featuredImage.existingUrl || '');
      setFeaturedImage({
        blob: featBlob || null,
        previewUrl: featUrl,
        name: pendingDraft.featuredImage.name || 'Featured Asset',
        isCropped: pendingDraft.featuredImage.isCropped ?? true,
        existingUrl: pendingDraft.featuredImage.existingUrl || null
      });
    } else {
      setFeaturedImage(null);
    }

    if (Array.isArray(pendingDraft.additionalImages)) {
      const restoredAddons = pendingDraft.additionalImages.map((img, i) => {
        const previewUrl = img.blob ? URL.createObjectURL(img.blob) : (img.existingUrl || '');
        return {
          id: img.id || `restored_${i}_${Date.now()}`,
          blob: img.blob || null,
          previewUrl,
          name: img.name || `Asset ${i + 1}`,
          isCropped: img.isCropped ?? true,
          existingUrl: img.existingUrl || null,
          title: img.title || '',
          desc: img.desc || ''
        };
      });
      setAdditionalImages(restoredAddons);
    }

    setShowRestorePrompt(false);
    setPendingDraft(null);
    setTimeout(() => {
      isRestoringRef.current = false;
    }, 200);
  };

  // Start fresh handler (clears draft after confirmation)
  const handleConfirmStartFresh = async () => {
    await clearDraft('project_draft_new');
    setShowStartFreshConfirm(false);
    setShowRestorePrompt(false);
    setPendingDraft(null);
    resetFormToBlank();
  };

  // Auto-save draft on changes (debounced)
  useEffect(() => {
    if (!isOpen || showRestorePrompt || isRestoringRef.current) return;
    // Do not auto-save during active upload or empty initial load
    if (status.state === 'uploading' || status.state === 'success') return;

    const timeout = setTimeout(() => {
      if (isFormDirty()) {
        const draftPayload = {
          formData,
          featuredImage: featuredImage ? {
            blob: featuredImage.blob,
            name: featuredImage.name,
            isCropped: featuredImage.isCropped,
            existingUrl: featuredImage.existingUrl
          } : null,
          additionalImages: additionalImages.map(img => ({
            id: img.id,
            blob: img.blob,
            name: img.name,
            isCropped: img.isCropped,
            existingUrl: img.existingUrl,
            title: img.title,
            desc: img.desc
          }))
        };
        saveDraft(draftKey, draftPayload);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [formData, featuredImage, additionalImages, isOpen, showRestorePrompt, draftKey, isFormDirty, status.state]);

  // Execute explicit close
  const executeClose = useCallback(() => {
    setShowUnsavedConfirm(false);
    resetFormToBlank();
    onClose();
  }, [onClose]);

  // Attempt close with unsaved changes verification
  const attemptClose = useCallback(() => {
    if (status.state === 'uploading') return;
    if (isFormDirty()) {
      setShowUnsavedConfirm(true);
    } else {
      executeClose();
    }
  }, [status.state, isFormDirty, executeClose]);

  // Keyboard navigation & safe Escape handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        // If crop modal or dialog is open, let that handle it or do nothing
        if (cropQueue.length > 0) return;
        if (showUnsavedConfirm || showRestorePrompt || showStartFreshConfirm) return;
        e.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, cropQueue.length, showUnsavedConfirm, showRestorePrompt, showStartFreshConfirm, attemptClose]);

  // Discard changes & clear draft
  const handleDiscardChanges = async () => {
    await clearDraft(draftKey);
    setShowUnsavedConfirm(false);
    resetFormToBlank();
    onClose();
  };

  // ==========================================
  // IMAGE SELECTION & SEQUENTIAL CROPPING QUEUE
  // ==========================================

  // 1. Featured image selection
  const handleFeaturedFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const item = {
        id: `feat_${Date.now()}`,
        type: 'featured',
        dataUrl: reader.result,
        name: file.name,
        file
      };
      setCropQueue([item]);
      setCurrentCropIndex(0);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input to allow selecting same file if desired
  };

  // 2. Additional images selection (incremental, up to 4 total)
  const handleAdditionalFilesSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentCount = additionalImages.length;
    const remainingSlots = MAX_ADDITIONAL_IMAGES - currentCount;

    if (remainingSlots <= 0) {
      alert(`Maximum of ${MAX_ADDITIONAL_IMAGES} additional images reached. Please remove an image before adding more.`);
      e.target.value = '';
      return;
    }

    // Filter out duplicates based on filename & size
    const existingNames = new Set(additionalImages.map(img => img.name));
    const uniqueFiles = files.filter(f => !existingNames.has(f.name));

    if (uniqueFiles.length < files.length) {
      console.log(`[ProjectModal] Skipped ${files.length - uniqueFiles.length} duplicate image(s).`);
    }

    if (uniqueFiles.length === 0) {
      alert("The selected image(s) have already been added to the project.");
      e.target.value = '';
      return;
    }

    // Take only up to remaining slots
    const filesToQueue = uniqueFiles.slice(0, remainingSlots);
    if (uniqueFiles.length > remainingSlots) {
      alert(`Only ${remainingSlots} slot(s) remaining. Added ${remainingSlots} of ${uniqueFiles.length} selected images.`);
    }

    // Read all files and build sequential queue
    const queuePromises = filesToQueue.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            id: `addon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'additional_new',
            dataUrl: reader.result,
            name: file.name,
            file
          });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(queuePromises).then(items => {
      setCropQueue(items);
      setCurrentCropIndex(0);
    });

    e.target.value = '';
  };

  // 3. Replace a single additional image
  const handleReplaceAdditionalImage = (index, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const targetImg = additionalImages[index];
    const reader = new FileReader();
    reader.onload = () => {
      const item = {
        id: `replace_${Date.now()}`,
        type: 'additional_replace',
        targetId: targetImg.id,
        targetIndex: index,
        dataUrl: reader.result,
        name: file.name,
        file
      };
      setCropQueue([item]);
      setCurrentCropIndex(0);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 4. Re-crop an existing additional image
  const handleRecropAdditionalImage = (index) => {
    const targetImg = additionalImages[index];
    if (!targetImg || !targetImg.previewUrl) return;

    const item = {
      id: `recrop_${Date.now()}`,
      type: 'additional_recrop',
      targetId: targetImg.id,
      targetIndex: index,
      dataUrl: targetImg.previewUrl,
      name: targetImg.name || `Asset ${index + 1}`
    };
    setCropQueue([item]);
    setCurrentCropIndex(0);
  };

  // 5. Remove a single additional image
  const handleRemoveAdditionalImage = (index) => {
    setAdditionalImages(prev => prev.filter((_, i) => i !== index));
  };

  // 6. Update metadata for an additional image
  const handleAdditionalMetaChange = (index, field, value) => {
    setAdditionalImages(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // ==========================================
  // SEQUENTIAL CROP COMPLETION & QUEUE ADVANCE
  // ==========================================

  const handleCurrentCropComplete = (blob) => {
    const currentItem = cropQueue[currentCropIndex];
    if (!currentItem) return;

    const previewUrl = URL.createObjectURL(blob);
    const isCropped = blob.preserveDimensions !== true;

    if (currentItem.type === 'featured') {
      setFeaturedImage({
        blob,
        previewUrl,
        name: currentItem.name || 'Featured Asset',
        isCropped,
        existingUrl: null
      });
    } else if (currentItem.type === 'additional_new') {
      setAdditionalImages(prev => {
        // Enforce max 4
        if (prev.length >= MAX_ADDITIONAL_IMAGES) return prev;
        return [
          ...prev,
          {
            id: currentItem.id,
            blob,
            previewUrl,
            name: currentItem.name,
            isCropped,
            existingUrl: null,
            title: '',
            desc: ''
          }
        ];
      });
    } else if (currentItem.type === 'additional_replace') {
      setAdditionalImages(prev => {
        return prev.map((img, i) => {
          if (i === currentItem.targetIndex || img.id === currentItem.targetId) {
            return {
              ...img,
              blob,
              previewUrl,
              name: currentItem.name,
              isCropped,
              existingUrl: null
            };
          }
          return img;
        });
      });
    } else if (currentItem.type === 'additional_recrop') {
      setAdditionalImages(prev => {
        return prev.map((img, i) => {
          if (i === currentItem.targetIndex || img.id === currentItem.targetId) {
            return {
              ...img,
              blob,
              previewUrl,
              isCropped
            };
          }
          return img;
        });
      });
    }

    advanceCropQueue();
  };

  const handleSkipCurrentCrop = () => {
    // Current image is skipped, previously completed crops are completely safe!
    advanceCropQueue();
  };

  const handleCancelCropQueue = () => {
    // Close cropper, previously completed crops remain intact!
    setCropQueue([]);
    setCurrentCropIndex(0);
  };

  const advanceCropQueue = () => {
    if (currentCropIndex + 1 < cropQueue.length) {
      setCurrentCropIndex(prev => prev + 1);
    } else {
      // Finished all queued images!
      setCropQueue([]);
      setCurrentCropIndex(0);
    }
  };

  // ==========================================
  // FORM SUBMISSION TO FIRESTORE & STORAGE
  // ==========================================

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent submission while cropping is active
    if (cropQueue.length > 0) {
      alert("Please finish or cancel active image cropping before publishing.");
      return;
    }

    // Required fields check
    if (!formData.title.trim()) {
      setStatus({ state: 'error', message: 'Project Title is required.' });
      return;
    }

    if (!formData.philosophy.trim()) {
      setStatus({ state: 'error', message: 'Architectural Philosophy is required.' });
      return;
    }

    if (!featuredImage || (!featuredImage.blob && !featuredImage.existingUrl)) {
      setStatus({ state: 'error', message: 'A featured photograph is required for every project.' });
      return;
    }

    // Spline URL Validation
    if (formData.splineUrl) {
      const isMySpline = formData.splineUrl.includes('my.spline.design');
      const isValid = formData.splineUrl.includes('prod.spline.design');
      
      if (isMySpline) {
        setStatus({ 
          state: 'error', 
          message: 'Please use the Export → Embed link (prod.spline.design) instead of the editor URL.' 
        });
        return;
      }
      
      if (!isValid) {
        setStatus({ 
          state: 'error', 
          message: 'Invalid Spline URL. Please provide a valid embed URL from Spline.' 
        });
        return;
      }
    }

    setStatus({ state: 'uploading', message: 'Optimizing and syncing architectural assets...' });

    try {
      console.log("--- Starting Safe Project Upload Flow ---");

      // 1. Upload Featured Image if new Blob
      let featuredUrl = featuredImage.existingUrl;
      if (featuredImage.blob) {
        console.log("Optimizing featured image for web...");
        const processedBlob = await processImageForWeb(featuredImage.blob, {
          maxWidth: 1920,
          preserveDimensions: !featuredImage.isCropped
        });
        featuredUrl = await uploadFile(processedBlob, `projects/main_${Date.now()}.webp`);
        await recordImageFingerprint(featuredImage.name || "featured", featuredUrl);

        if (!featuredUrl) {
          throw new Error("Failed to receive a valid URL for featured image.");
        }
      }

      // 2. Upload Additional Images if new Blobs
      const finalAdditionalObjects = [];
      for (let i = 0; i < additionalImages.length; i++) {
        const item = additionalImages[i];
        let itemUrl = item.existingUrl;

        if (item.blob) {
          console.log(`Optimizing additional image ${i + 1} (${item.name})...`);
          const processedBlob = await processImageForWeb(item.blob, {
            maxWidth: 1600,
            preserveDimensions: !item.isCropped
          });
          itemUrl = await uploadFile(processedBlob, `projects/gallery_${Date.now()}_${i}.webp`);
          await recordImageFingerprint(item.name || `gallery_${i}`, itemUrl);

          if (!itemUrl) {
            throw new Error(`Failed to upload additional image ${i + 1}`);
          }
        }

        finalAdditionalObjects.push({
          url: itemUrl,
          title: item.title || `${formData.title} - View ${i + 1}`,
          description: item.desc || formData.subtitle || "Architectural Perspective"
        });
      }

      // 3. Assemble Unified Images Array (Featured image at index 0)
      const finalImages = [
        {
          url: featuredUrl,
          title: formData.title,
          description: formData.subtitle || "Featured Photo"
        },
        ...finalAdditionalObjects
      ];

      // 4. Construct Firestore Document Payload
      const projectPayload = {
        title: formData.title.trim(),
        subtitle: (formData.subtitle || '').trim(),
        philosophy: formData.philosophy.trim(),
        mainImage: featuredUrl,
        location: (formData.location || '').trim(),
        scale: (formData.scale || '').trim(),
        completion: (formData.completion || '').trim(),
        materials: (formData.materials || '').trim(),
        splineUrl: (formData.splineUrl || '').trim(),
        images: finalImages
      };

      console.log("Saving project payload to Firestore...");

      if (initialData?.id) {
        await updateProject(initialData.id, projectPayload);
        setStatus({ state: 'success', message: 'Project successfully updated!' });
      } else {
        await createProject(projectPayload);
        setStatus({ state: 'success', message: 'Project successfully published!' });
      }

      // CLEAR SAVED DRAFT ONLY AFTER CONFIRMED DATABASE WRITE
      await clearDraft(draftKey);

      if (onSuccess) onSuccess();

      setTimeout(() => {
        executeClose();
      }, 1200);

    } catch (err) {
      console.error("Project Upload Fault:", err);
      // Retain form data intact when error occurs!
      setStatus({ state: 'error', message: err.message || 'System fault occurred during upload.' });
    }
  };

  // Consistent rounded rectangular input styles
  const inputStyle = "w-full bg-[#120B07] border border-white/15 rounded-[12px] px-4 py-3.5 font-body text-sm text-primary-text placeholder:text-white/35 focus:border-accent focus:bg-[#180E09] focus:outline-none transition-all duration-200";
  const smallInputStyle = "w-full bg-[#120B07] border border-white/15 rounded-[12px] px-3.5 py-2.5 font-body text-xs text-primary-text placeholder:text-white/35 focus:border-accent focus:bg-[#180E09] focus:outline-none transition-all duration-200";
  const textareaStyle = "w-full bg-[#120B07] border border-white/15 rounded-[12px] p-4 font-body text-sm text-primary-text placeholder:text-white/35 focus:border-accent focus:bg-[#180E09] focus:outline-none transition-all duration-200 resize-y min-h-[115px] leading-relaxed";

  const currentCropQueueItem = cropQueue[currentCropIndex];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay: CLICKING OUTSIDE DOES NOT CLOSE MODAL */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/85 backdrop-blur-md z-[100]"
          />

          {/* Sequential Cropper Modal */}
          <ImageCropModal 
            isOpen={cropQueue.length > 0}
            image={currentCropQueueItem?.dataUrl}
            onCancel={handleSkipCurrentCrop}
            onCropComplete={handleCurrentCropComplete}
            queueProgress={cropQueue.length > 0 ? {
              current: currentCropIndex + 1,
              total: cropQueue.length,
              fileName: currentCropQueueItem?.name
            } : undefined}
            onSkip={cropQueue.length > 1 ? handleSkipCurrentCrop : undefined}
            onCancelQueue={cropQueue.length > 1 ? handleCancelCropQueue : undefined}
          />

          {/* Confirmation: Restore Unfinished Draft */}
          {showRestorePrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-background/90 backdrop-blur-lg"
            >
              <div className="bg-card-bg border border-accent/30 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                    <span className="material-symbols-outlined text-xl">history</span>
                  </div>
                  <div>
                    <span className="font-label text-[10px] tracking-[0.25em] uppercase text-accent font-semibold block">Draft Detected</span>
                    <h3 className="font-headline font-bold text-lg text-primary-text">Restore previous project draft?</h3>
                  </div>
                </div>
                <p className="font-body text-xs sm:text-sm text-primary-text/70 leading-relaxed">
                  You have an unfinished project draft. Would you like to continue where you left off?
                </p>
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowStartFreshConfirm(true)}
                    className="px-4 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider text-primary-text/50 hover:text-red-400 hover:bg-white/5 transition-all"
                  >
                    Start Fresh
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreDraft}
                    className="bg-accent text-on-accent px-6 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    Restore Draft
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Confirmation: Confirm Start Fresh (deleting draft) */}
          {showStartFreshConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-background/90 backdrop-blur-lg"
            >
              <div className="bg-card-bg border border-red-500/30 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
                    <span className="material-symbols-outlined text-xl">delete_forever</span>
                  </div>
                  <div>
                    <span className="font-label text-[10px] tracking-[0.25em] uppercase text-red-400 font-semibold block">Permanent Action</span>
                    <h3 className="font-headline font-bold text-lg text-primary-text">Discard saved draft?</h3>
                  </div>
                </div>
                <p className="font-body text-xs sm:text-sm text-primary-text/70 leading-relaxed">
                  Are you sure you want to start fresh? Your previously saved draft and uncropped assets will be permanently deleted.
                </p>
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowStartFreshConfirm(false)}
                    className="px-4 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider text-primary-text/60 hover:text-primary-text transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmStartFresh}
                    className="bg-red-500 text-white px-6 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider shadow-lg hover:bg-red-600 transition-all"
                  >
                    Discard & Start Fresh
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Confirmation: Unsaved changes on close */}
          {showUnsavedConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[215] flex items-center justify-center p-4 bg-background/90 backdrop-blur-lg"
            >
              <div className="bg-card-bg border border-amber-500/30 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <span className="material-symbols-outlined text-xl">warning</span>
                  </div>
                  <div>
                    <span className="font-label text-[10px] tracking-[0.25em] uppercase text-amber-400 font-semibold block">Unsaved Form Data</span>
                    <h3 className="font-headline font-bold text-lg text-primary-text">You have unsaved changes</h3>
                  </div>
                </div>
                <p className="font-body text-xs sm:text-sm text-primary-text/70 leading-relaxed">
                  You have unsaved changes in your project form. Are you sure you want to discard them?
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUnsavedConfirm(false)}
                    className="bg-accent text-on-accent px-5 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-center"
                  >
                    Continue Editing
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardChanges}
                    className="px-4 py-2.5 rounded-xl font-headline text-xs font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all text-center"
                  >
                    Discard Changes
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Main Modal Dialog */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, y: 25, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] md:w-[90vw] max-w-2xl lg:max-w-3xl bg-card-bg border border-white/10 p-6 sm:p-8 md:p-10 rounded-[28px] md:rounded-[32px] shadow-[0_30px_100px_rgba(0,0,0,0.85)] z-[101] max-h-[90vh] overflow-y-auto custom-scrollbar"
            role="dialog"
            aria-modal="true"
          >
            {/* Header with clearly visible close button */}
            <div className="flex justify-between items-start mb-8 pb-4 border-b border-white/5">
              <div>
                <span className="font-label text-[10px] tracking-[0.3em] uppercase text-accent mb-1.5 block font-semibold">
                  Architectural Archive
                </span>
                <h2 className="font-headline font-extrabold text-2xl md:text-3xl uppercase tracking-wider text-primary-text">
                  {initialData ? 'Edit Piece' : 'Add New Piece'}
                </h2>
              </div>
              <button 
                type="button" 
                onClick={attemptClose} 
                className="w-11 h-11 bg-white/5 rounded-full text-primary-text/40 hover:bg-white/10 hover:text-red-400 transition-all flex items-center justify-center active:scale-90" 
                aria-label="Close form"
                title="Close (Esc)"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            {/* Status Feedback Banner */}
            {status.message && (
              <div className={`p-4 rounded-xl font-body text-sm mb-6 flex items-center gap-3 border ${
                status.state === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                status.state === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                'bg-accent/10 text-accent border-accent/20'
              }`}>
                {status.state === 'uploading' && (
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent flex-shrink-0 rounded-full animate-spin" />
                )}
                {status.state === 'error' && (
                  <span className="material-symbols-outlined text-lg flex-shrink-0">error</span>
                )}
                {status.state === 'success' && (
                  <span className="material-symbols-outlined text-lg flex-shrink-0">check_circle</span>
                )}
                <span className="leading-snug">{status.message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Project Title */}
              <div className="space-y-2">
                <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                  Project Title <span className="text-accent">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className={inputStyle}
                  placeholder="e.g. The Glass Pavilion"
                  disabled={status.state === 'uploading'}
                  required
                />
              </div>

              {/* Subtitle */}
              <div className="space-y-2">
                <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                  Archive Subtitle (Study Classification)
                </label>
                <input
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
                  className={inputStyle}
                  placeholder="e.g. Residential Observation & Spatial Monolith"
                  disabled={status.state === 'uploading'}
                />
              </div>

              {/* Philosophy / Description */}
              <div className="space-y-2">
                <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                  Architectural Philosophy <span className="text-accent">*</span>
                </label>
                <textarea
                  value={formData.philosophy}
                  onChange={(e) => setFormData(prev => ({ ...prev, philosophy: e.target.value }))}
                  className={textareaStyle}
                  placeholder="Articulate the structural philosophy, context, light, and material dialogue..."
                  disabled={status.state === 'uploading'}
                  required
                />
              </div>

              {/* Attributes Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                    Location
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    className={smallInputStyle}
                    placeholder="e.g. Western Ghats, Maharashtra"
                    disabled={status.state === 'uploading'}
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                    Scale / Area
                  </label>
                  <input
                    type="text"
                    value={formData.scale}
                    onChange={(e) => setFormData(prev => ({ ...prev, scale: e.target.value }))}
                    className={smallInputStyle}
                    placeholder="e.g. 450 sqm / 4,800 sqft"
                    disabled={status.state === 'uploading'}
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                    Year of Completion
                  </label>
                  <input
                    type="text"
                    value={formData.completion}
                    onChange={(e) => setFormData(prev => ({ ...prev, completion: e.target.value }))}
                    className={smallInputStyle}
                    placeholder="e.g. 2025"
                    disabled={status.state === 'uploading'}
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                    Primary Materials
                  </label>
                  <input
                    type="text"
                    value={formData.materials}
                    onChange={(e) => setFormData(prev => ({ ...prev, materials: e.target.value }))}
                    className={smallInputStyle}
                    placeholder="e.g. Exposed Basalt, Raw Concrete, Teak"
                    disabled={status.state === 'uploading'}
                  />
                </div>
              </div>

              {/* Spline 3D Link */}
              <div className="space-y-2">
                <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 ml-1 font-semibold">
                  Spline 3D Embed Link (Optional)
                </label>
                <input
                  type="url"
                  value={formData.splineUrl}
                  onChange={(e) => setFormData(prev => ({ ...prev, splineUrl: e.target.value }))}
                  className={`w-full bg-[#120B07] border rounded-[12px] px-4 py-3.5 font-body text-sm text-primary-text placeholder:text-white/35 focus:outline-none transition-all ${
                    formData.splineUrl && formData.splineUrl.includes('my.spline.design') 
                      ? 'border-amber-500/50 focus:border-amber-500' 
                      : 'border-white/15 focus:border-accent'
                  }`}
                  placeholder="https://prod.spline.design/..."
                  disabled={status.state === 'uploading'}
                />
                {formData.splineUrl && formData.splineUrl.includes('my.spline.design') && (
                  <p className="text-[10px] text-amber-400 mt-1 ml-1 leading-relaxed font-body">
                    ⚠️ Tip: Please use the production embed link (Export → Embed → prod.spline.design) rather than the editor URL.
                  </p>
                )}
              </div>

              {/* =========================================
                  FEATURED PHOTOGRAPH (Single)
                  ========================================= */}
              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 font-semibold">
                    Featured Photograph <span className="text-accent">*</span>
                  </label>
                  {featuredImage && (
                    <span className="text-[10px] text-accent/80 font-label uppercase tracking-wider">
                      {featuredImage.isCropped ? 'Cropped & Ready' : 'Original Ratio Preserved'}
                    </span>
                  )}
                </div>

                <div className="w-full border-2 border-dashed border-white/15 rounded-[16px] p-4 flex flex-col items-center justify-center bg-[#120B07]/60 hover:bg-[#120B07] transition-all relative overflow-hidden group min-h-[170px]">
                  {featuredImage?.previewUrl ? (
                    <div className="w-full relative rounded-xl overflow-hidden aspect-video bg-black/40">
                      <img 
                        src={featuredImage.previewUrl} 
                        className="w-full h-full object-cover" 
                        alt="Featured Preview" 
                      />
                      <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="cursor-pointer bg-accent text-on-accent px-4 py-2 rounded-full font-headline text-[10px] uppercase tracking-widest font-bold shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">swap_horiz</span>
                          Replace
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFeaturedFileSelect}
                            className="hidden"
                            disabled={status.state === 'uploading'}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-6">
                      <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent group-hover:scale-110 transition-transform mb-3">
                        <span className="material-symbols-outlined text-2xl">add_photo_alternate</span>
                      </div>
                      <p className="font-body text-xs sm:text-sm text-primary-text/80 text-center font-medium">
                        <span className="text-accent font-semibold">Click to select featured photograph</span>
                      </p>
                      <p className="text-[10px] text-primary-text/40 tracking-wider uppercase mt-1">
                        Opens automatic cropping tool upon selection
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFeaturedFileSelect}
                        className="hidden"
                        disabled={status.state === 'uploading'}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* =========================================
                  ADDITIONAL IMAGES (Up to 4 Gallery)
                  ========================================= */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 ml-1">
                  <label className="font-label text-[10px] tracking-[0.2em] uppercase text-primary-text/50 font-semibold">
                    Additional Gallery Images
                  </label>
                  <span className={`text-[10px] font-headline font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                    additionalImages.length >= MAX_ADDITIONAL_IMAGES 
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' 
                      : 'bg-white/5 text-primary-text/60 border-white/10'
                  }`}>
                    {additionalImages.length} of {MAX_ADDITIONAL_IMAGES} slots used · {MAX_ADDITIONAL_IMAGES - additionalImages.length} remaining
                  </span>
                </div>

                {/* Additional Images Grid / Cards */}
                {additionalImages.length > 0 && (
                  <div className="space-y-4">
                    {additionalImages.map((img, index) => (
                      <div 
                        key={img.id || index}
                        className="bg-[#140C08] border border-white/10 hover:border-white/20 rounded-[16px] p-4 sm:p-5 flex flex-col md:flex-row gap-5 items-start relative group transition-all"
                      >
                        {/* Thumbnail & Actions Container */}
                        <div className="w-full md:w-48 shrink-0 flex flex-col gap-2">
                          <div className="relative w-full aspect-[16/10] rounded-[10px] overflow-hidden bg-black/60 border border-white/10 shadow-inner group/thumb">
                            <img 
                              src={img.previewUrl} 
                              className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-105" 
                              alt={`Asset ${index + 1}`} 
                            />
                            <span className="absolute top-2 left-2 bg-background/85 backdrop-blur-md text-[9px] font-headline font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-accent border border-accent/20 shadow-sm">
                              Asset 0{index + 1}
                            </span>
                            <span className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-md text-[8px] font-body text-white/70 px-1.5 py-0.5 rounded border border-white/10">
                              {img.isCropped ? 'Cropped' : 'Original'}
                            </span>
                          </div>

                          {/* Quick Actions Row */}
                          <div className="flex items-center gap-1.5 justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => handleRecropAdditionalImage(index)}
                              className="flex-1 py-1.5 px-2 bg-white/5 hover:bg-accent hover:text-on-accent text-primary-text/70 rounded-[8px] border border-white/10 hover:border-accent font-headline text-[9px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                              title="Re-crop this perspective"
                            >
                              <span className="material-symbols-outlined text-[13px]">crop</span>
                              Crop
                            </button>

                            <label 
                              className="flex-1 py-1.5 px-2 bg-white/5 hover:bg-white/15 text-primary-text/70 hover:text-primary-text rounded-[8px] border border-white/10 font-headline text-[9px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all"
                              title="Replace this image with another file"
                            >
                              <span className="material-symbols-outlined text-[13px]">sync</span>
                              Replace
                              <input 
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleReplaceAdditionalImage(index, e)}
                                className="hidden"
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => handleRemoveAdditionalImage(index)}
                              className="py-1.5 px-2.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-[8px] border border-red-500/20 font-headline text-[9px] font-bold uppercase tracking-wider flex items-center justify-center transition-all"
                              title="Delete this asset slot"
                            >
                              <span className="material-symbols-outlined text-[13px]">delete</span>
                            </button>
                          </div>
                        </div>

                        {/* Title and Description Inputs */}
                        <div className="flex-1 w-full space-y-3">
                          <div className="flex justify-between items-center pb-1 border-b border-white/5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2 h-2 rounded-full bg-accent inline-block shrink-0" />
                              <span className="text-[11px] font-headline font-bold uppercase tracking-wider text-primary-text truncate">
                                Perspective Asset {index + 1}
                              </span>
                              {img.name && (
                                <span className="text-[10px] font-mono text-primary-text/40 truncate hidden sm:inline max-w-xs">
                                  ({img.name})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAdditionalImage(index)}
                              className="text-primary-text/40 hover:text-red-400 transition-colors p-1"
                              title="Remove"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            <label className="font-label text-[9px] tracking-[0.2em] uppercase text-primary-text/40 block ml-0.5">
                              Image Title
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. North Elevation, Light Court, Detail Study"
                              value={img.title || ''}
                              onChange={(e) => handleAdditionalMetaChange(index, 'title', e.target.value)}
                              className="w-full bg-[#180E09] border border-white/10 rounded-[10px] px-3.5 py-2.5 font-body text-xs text-primary-text placeholder:text-white/30 focus:border-accent focus:outline-none transition-colors"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="font-label text-[9px] tracking-[0.2em] uppercase text-primary-text/40 block ml-0.5">
                              Architectural Perspective Description
                            </label>
                            <textarea
                              placeholder="Describe the light dialogue, materials, or structural angle of this view..."
                              rows={2}
                              value={img.desc || ''}
                              onChange={(e) => handleAdditionalMetaChange(index, 'desc', e.target.value)}
                              className="w-full bg-[#180E09] border border-white/10 rounded-[10px] px-3.5 py-2.5 font-body text-xs text-primary-text placeholder:text-white/30 focus:border-accent focus:outline-none transition-colors resize-none leading-relaxed"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Images Dropzone / Button (Enabled if < 4) */}
                {additionalImages.length < MAX_ADDITIONAL_IMAGES ? (
                  <div className="w-full border-2 border-dashed border-white/15 rounded-[16px] p-5 flex flex-col items-center justify-center bg-[#120B07]/40 hover:bg-[#120B07] transition-all relative overflow-hidden group">
                    <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer py-3">
                      <div className="flex items-center gap-2 text-accent font-headline font-bold text-xs uppercase tracking-wider mb-1">
                        <span className="material-symbols-outlined text-lg">add_photo_alternate</span>
                        Add Additional Images
                      </div>
                      <p className="text-[11px] font-body text-primary-text/60 text-center">
                        Select 1 or more images (up to {MAX_ADDITIONAL_IMAGES - additionalImages.length} available)
                      </p>
                      <p className="text-[9px] font-label text-primary-text/40 tracking-wider uppercase mt-1">
                        Images are automatically queued for sequential cropping
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleAdditionalFilesSelect}
                        className="hidden"
                        disabled={status.state === 'uploading'}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="p-3 bg-white/5 border border-white/10 rounded-[12px] text-center text-primary-text/50 font-body text-xs">
                    All 4 additional image slots are currently filled. Remove an image to add a different one.
                  </div>
                )}
              </div>

              {/* Form Footer Buttons */}
              <div className="pt-8 border-t border-white/10 flex flex-col-reverse sm:flex-row justify-end gap-3 sm:gap-4 items-center">
                <button
                  type="button"
                  onClick={attemptClose}
                  disabled={status.state === 'uploading'}
                  className="w-full sm:w-auto font-headline text-[11px] font-bold uppercase tracking-widest text-primary-text/50 hover:text-primary-text transition-colors disabled:opacity-30 py-3 px-6 text-center"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={status.state === 'uploading' || cropQueue.length > 0}
                  className="w-full sm:w-auto bg-accent text-on-accent px-8 py-3.5 rounded-full font-headline font-bold text-xs uppercase tracking-widest shadow-xl shadow-accent/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {status.state === 'uploading' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-on-accent border-t-transparent rounded-full animate-spin" />
                      Publishing to Archive...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[1.1rem]">cloud_done</span>
                      {initialData ? 'Update Project' : 'Publish Project'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
