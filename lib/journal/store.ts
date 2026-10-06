import chatSnapshot from './chat-snapshot.json';
import { env } from 'cloudflare:workers';
import { validateEnvelope, mergeRecords, EMPTY_PROFILE } from './model.js';
import { JournalError, ownerIdentity } from './auth';
import { photoIdPattern, validatePhotoBytes } from './photo';
const runtime = env as unknown as {
    DB: D1Database;
    PHOTOS: R2Bucket;
    OWNER_EMAIL?: string;
    INITIAL_JOURNAL?: string;
};
export function bindings() { if (!runtime.DB || !runtime.PHOTOS)
    throw new JournalError(503, '私人存储暂时不可用。'); return runtime; }
export function owner(headers: Headers) { return ownerIdentity(headers, runtime.OWNER_EMAIL); }
function cleaned(raw: any) { const next = validateEnvelope(raw); if (!next.profile)
    throw new JournalError(400, '日记缺少个人资料。'); const metadata = raw.metadata ?? {}; if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 5000)
    throw new JournalError(400, '附加资料格式不正确。'); return { ...next, demo: false, metadata }; }
export async function loadJournal(ownerId: string, applySnapshot = true):Promise<{state:any;revision:number;syncWarning?:string}> { const { DB } = bindings(); let row = await DB.prepare('SELECT state,revision FROM journals WHERE owner_id=?').bind(ownerId).first<{
    state: string;
    revision: number;
}>(); if (!row) {
    let initial = { version: 1, timezone: 'Asia/Shanghai', profile: { ...EMPTY_PROFILE }, meals: [], weights: [], completeness: {}, budgets: [], metadata: {} };
    if (runtime.INITIAL_JOURNAL)
        initial = cleaned(JSON.parse(runtime.INITIAL_JOURNAL));
    await DB.prepare('INSERT OR IGNORE INTO journals(owner_id,state,revision,updated_at) VALUES(?,?,0,?)').bind(ownerId, JSON.stringify(initial), new Date().toISOString()).run();
    row = await DB.prepare('SELECT state,revision FROM journals WHERE owner_id=?').bind(ownerId).first<{
        state: string;
        revision: number;
    }>();
} if (!row)
    throw new JournalError(503, '读取失败。'); const result = { state: JSON.parse(row.state), revision: row.revision }; if (applySnapshot && (chatSnapshot.payload.meals.length || chatSnapshot.payload.weights.length || Object.keys(chatSnapshot.payload.completeness).length)) {
    try {
        await applyChatSnapshot(ownerId);
        return await loadJournal(ownerId, false);
    }
    catch (error) {
        if (!(error instanceof JournalError))
            throw error;
        return { ...await loadJournal(ownerId, false), syncWarning: '聊天整理的更新暂未合并：' + error.message + ' 已有记录仍可查看和编辑。' };
    }
} return result; }
export async function saveJournal(ownerId: string, raw: any, expectedRevision: number, receipt?: {
    requestId: string;
    hash: string;
    report: any;
}) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
        throw new JournalError(400, '需要当前版本号。');
    let next;
    try {
        next = cleaned(raw);
    }
    catch (error) {
        throw new JournalError(400, error instanceof Error ? error.message : '记录格式错误。');
    }
    if (next.meals.some((m: any) => m.photo.startsWith('data:')))
        throw new JournalError(400, '照片需先存入私人照片存储。');
    const current = await loadJournal(ownerId, false);
    if (current.revision !== expectedRevision)
        throw new JournalError(409, '记录已在另一处更新。请刷新后重新检查，避免覆盖。');
    const { DB } = bindings();
    for (const meal of next.meals) {
        if (meal.photo) {
            const id = meal.photo.split('/').pop();
            const photo = await DB.prepare('SELECT id FROM photos WHERE id=? AND owner_id=?').bind(id, ownerId).first();
            if (!photo)
                throw new JournalError(400, '照片不属于当前日记。');
        }
    }
    const stamp = new Date().toISOString();
    const statements = [DB.prepare('INSERT OR IGNORE INTO journal_revisions(owner_id,revision,state,created_at) SELECT owner_id,revision,state,? FROM journals WHERE owner_id=? AND revision=?').bind(stamp, ownerId, expectedRevision), DB.prepare('UPDATE journals SET state=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM receipts WHERE owner_id=? AND request_id=?)').bind(JSON.stringify(next), stamp, ownerId, expectedRevision, ownerId, receipt?.requestId || '__no-receipt__')];
    if (receipt)
        statements.push(DB.prepare('INSERT INTO receipts(owner_id,request_id,payload_hash,report,created_at) SELECT ?,?,?,?,? WHERE changes()=1').bind(ownerId, receipt.requestId, receipt.hash, JSON.stringify(receipt.report), stamp));
    const results = await DB.batch(statements);
    if (results[1].meta.changes !== 1)
        throw new JournalError(409, '另一处刚更新了记录，请刷新后重试。');
    return { state: next, revision: expectedRevision + 1 };
}
export async function ingest(ownerId: string, payload: any, requestId: string) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
        throw new JournalError(400, '请提供稳定的请求 ID。');
    if (!payload || typeof payload!=='object' || ['profile','budgets','ownerId','owner_id'].some(key=>Object.hasOwn(payload,key)))
        throw new JournalError(400, '聊天记录写入不能更改所有者、资料或目标。');
    let normalized;
    try {
        normalized = validateEnvelope(payload);
    }
    catch (error) {
        throw new JournalError(400, error instanceof Error ? error.message : '记录格式错误。');
    }
    if (normalized.meals.length + normalized.weights.length > 100)
        throw new JournalError(400, '每次最多 100 条记录。');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized))))].map(v => v.toString(16).padStart(2, '0')).join('');
    const { DB } = bindings();
    const receipt = await DB.prepare('SELECT payload_hash,report FROM receipts WHERE owner_id=? AND request_id=?').bind(ownerId, requestId).first<{
        payload_hash: string;
        report: string;
    }>();
    if (receipt) {
        if (receipt.payload_hash !== hash)
            throw new JournalError(409, '请求 ID 已用于不同内容。');
        return { ...JSON.parse(receipt.report), replayed: true };
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const current = await loadJournal(ownerId, false);
        let merged;
        try {
            merged = mergeRecords(current.state, normalized);
        }
        catch (error) {
            throw new JournalError(409, error instanceof Error ? error.message : '记录冲突。');
        }
        try {
            const report = { ...merged.report, replayed: false };
            await saveJournal(ownerId, merged.state, current.revision, { requestId, hash, report });
            return report;
        }
        catch (error) {
            if (!(error instanceof JournalError) || error.status !== 409)
                throw error;
            const replay = await DB.prepare('SELECT payload_hash,report FROM receipts WHERE owner_id=? AND request_id=?').bind(ownerId, requestId).first<{
                payload_hash: string;
                report: string;
            }>();
            if (replay) {
                if (replay.payload_hash !== hash)
                    throw new JournalError(409, '请求 ID 已用于不同内容。');
                return { ...JSON.parse(replay.report), replayed: true };
            }
            if (attempt === 1)
                throw error;
        }
    }
    throw new JournalError(409, '更新冲突，请稍后用同一请求 ID 重试。');
}
async function applyChatSnapshot(ownerId: string) {
    const { DB, PHOTOS } = bindings();
    const receipt = await DB.prepare('SELECT request_id FROM receipts WHERE owner_id=? AND request_id=?').bind(ownerId, chatSnapshot.batchId).first();
    if (receipt) {
        await ingest(ownerId, chatSnapshot.payload, chatSnapshot.batchId);
        return;
    }
    // Validate and resolve record conflicts before mutating photo storage.
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(chatSnapshot.batchId))
        throw new JournalError(400, '聊天批次 ID 格式错误。');
    let payload;
    try {
        payload = validateEnvelope(chatSnapshot.payload);
        const current = await loadJournal(ownerId, false);
        mergeRecords(current.state, payload);
    }
    catch (error) {
        throw new JournalError(409, error instanceof Error ? error.message : '聊天记录格式错误。');
    }
    if (payload.profile || ('budgets' in chatSnapshot.payload) || payload.meals.length + payload.weights.length > 100)
        throw new JournalError(400, '聊天更新范围不正确。');
    const photos = chatSnapshot.photos as Array<{
        id: string;
        mime: string;
        base64: string;
    }>;
    if (!Array.isArray(photos) || photos.length > 20 || new Set(photos.map(p => p.id)).size !== photos.length)
        throw new JournalError(400, '聊天照片数量或 ID 不正确。');
    const checked = [];
    let totalBytes = 0;
    for (const item of photos) {
        if (!photoIdPattern.test(item.id) || typeof item.base64 !== 'string' || item.base64.length > 4194304 || !payload.meals.some((meal: any) => meal.photo === `/api/photos/${item.id}`))
            throw new JournalError(400, '聊天照片格式或关联记录不正确。');
        let bytes;
        try {
            bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
        }
        catch {
            throw new JournalError(400, '照片编码不正确。');
        }
        validatePhotoBytes(bytes, item.mime);
        totalBytes += bytes.byteLength;
        if (totalBytes > 8388608)
            throw new JournalError(413, '聊天照片合计最多 8 MB，请分批更新。');
        const existing = await DB.prepare('SELECT owner_id,object_key,mime FROM photos WHERE id=?').bind(item.id).first<{
            owner_id: string;
            object_key: string;
            mime: string;
        }>();
        if (existing) {
            if (existing.owner_id !== ownerId || existing.mime !== item.mime)
                throw new JournalError(409, '照片 ID 已被使用，请为新照片使用新 ID。');
            const object = await PHOTOS.get(existing.object_key);
            const stored = object ? new Uint8Array(await object.arrayBuffer()) : null;
            if (!stored || stored.length !== bytes.length || stored.some((value, index) => value !== bytes[index]))
                throw new JournalError(409, '已有照片内容不同，请为新照片使用新 ID。');
        }
        checked.push({ item, bytes, existing });
    }
    for (const { item, bytes, existing } of checked) {
        if (existing)
            continue;
        const key = `${ownerId}/${item.id}`;
        await PHOTOS.put(key, bytes, { httpMetadata: { contentType: item.mime } });
        try {
            await DB.prepare('INSERT INTO photos(id,owner_id,object_key,mime,created_at) VALUES(?,?,?,?,?)').bind(item.id, ownerId, key, item.mime, new Date().toISOString()).run();
        }
        catch (error) {
            await PHOTOS.delete(key);
            throw error;
        }
    }
    await ingest(ownerId, chatSnapshot.payload, chatSnapshot.batchId);
}
