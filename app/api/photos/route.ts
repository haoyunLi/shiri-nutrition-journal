import { owner, bindings } from '@/lib/journal/store';
import { checkBrowserOrigin, privateResponse, errorResponse, JournalError } from '@/lib/journal/auth';
import { validatePhotoBytes } from '@/lib/journal/photo';
export async function POST(request: Request) { try {
    checkBrowserOrigin(request);
    const ownerId = owner(request.headers), { DB, PHOTOS } = bindings();
    const type = request.headers.get('content-type') || '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type))
        throw new JournalError(400, '仅接受 JPEG、PNG 或 WebP。');
    const bytes = await request.arrayBuffer();
    validatePhotoBytes(new Uint8Array(bytes), type);
    const id = crypto.randomUUID(), key = `${ownerId}/${id}`;
    await PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
        await DB.prepare('INSERT INTO photos(id,owner_id,object_key,mime,created_at) VALUES(?,?,?,?,?)').bind(id, ownerId, key, type, new Date().toISOString()).run();
    }
    catch (error) {
        await PHOTOS.delete(key);
        throw error;
    }
    return privateResponse({ photo: `/api/photos/${id}` });
}
catch (error) {
    return errorResponse(error);
} }
