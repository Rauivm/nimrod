const MAX_IMAGE_EDGE = 1920;
const JPEG_QUALITY = 0.82;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function optimizeImageFile(file) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif' || file.size < 900_000) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, '.jpg');
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
