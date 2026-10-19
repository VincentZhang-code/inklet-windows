export function readableImagePath(value) {
  const text = String(value ?? '');
  try { return decodeURIComponent(text); } catch { return text; }
}

export function isImagePlaceholder(value) {
  return /^(?:\u5360\u4f4d(?:\u7b26)?|placeholder)(?:\s*[:\uFF1A]|$)/i.test(readableImagePath(value).trim());
}