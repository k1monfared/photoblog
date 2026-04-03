// Image picker, resize, compress for photoblog specs

import { saveImage, getImagesForSession, deleteImage } from './storage.js';

const MAX_WIDTH = 1200;
const MAX_HEIGHT = 1600;
const JPEG_QUALITY = 0.85;
const THUMB_HEIGHT = 80;

function sanitizeFilename(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w.\-]/g, '');
}

export async function pickImages() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) {
        resolve([]);
        return;
      }
      const results = [];
      for (const file of input.files) {
        const processed = await processImage(file);
        if (processed) results.push(processed);
      }
      resolve(results);
    };
    input.click();
  });
}

async function processImage(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  // Resize to fit within MAX_WIDTH x MAX_HEIGHT
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Web image (JPEG)
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const webBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  const webBuffer = await webBlob.arrayBuffer();

  // Thumbnail (PNG, 80px height)
  const thumbRatio = THUMB_HEIGHT / height;
  const thumbW = Math.round(width * thumbRatio);
  const thumbCanvas = new OffscreenCanvas(thumbW, THUMB_HEIGHT);
  const thumbCtx = thumbCanvas.getContext('2d');
  thumbCtx.drawImage(bitmap, 0, 0, thumbW, THUMB_HEIGHT);
  bitmap.close();

  const thumbBlob = await thumbCanvas.convertToBlob({ type: 'image/png' });
  const thumbBuffer = await thumbBlob.arrayBuffer();

  let name = sanitizeFilename(file.name);
  if (!name.endsWith('.jpg') && !name.endsWith('.jpeg')) {
    name = name.replace(/\.[^.]+$/, '.jpg');
  }

  return {
    name,
    webBase64: arrayBufferToBase64(webBuffer),
    thumbBase64: arrayBufferToBase64(thumbBuffer),
    webData: webBuffer,
    thumbData: thumbBuffer,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function storeImage(sessionId, imageData) {
  const id = `${sessionId}_${imageData.name}`;
  const record = {
    id,
    sessionId,
    name: imageData.name,
    webBase64: imageData.webBase64,
    thumbBase64: imageData.thumbBase64,
    webData: imageData.webData,
    thumbData: imageData.thumbData,
  };
  await saveImage(record);
  return record;
}

export async function getStoredImages(sessionId) {
  return getImagesForSession(sessionId);
}

export async function removeStoredImage(id) {
  await deleteImage(id);
}

export function createThumbnailUrl(imageRecord) {
  const bytes = new Uint8Array(imageRecord.thumbData || imageRecord.webData);
  const type = imageRecord.thumbData ? 'image/png' : 'image/jpeg';
  const blob = new Blob([bytes], { type });
  return URL.createObjectURL(blob);
}
