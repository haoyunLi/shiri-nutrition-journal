import { JournalError } from './auth';

export const photoIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validatePhotoBytes(bytes: Uint8Array, mime: string) {
  if (!bytes.byteLength || bytes.byteLength > 3145728) throw new JournalError(413, '照片最多 3 MB。');
  const prefix = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  const valid = mime === 'image/jpeg' && prefix(255, 216, 255)
    || mime === 'image/png' && prefix(137, 80, 78, 71, 13, 10, 26, 10)
    || mime === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new JournalError(400, '照片文件内容与格式不符。');
}
