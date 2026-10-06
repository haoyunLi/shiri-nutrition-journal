import { validateEnvelope, mergeRecords } from './model.js';

// Read-only preflight. An exported embedded photo and its stored reference must
// compare as the same record before duplicate/conflict checks or any upload.
export async function prepareImport(current, raw, readPhoto) {
  const incoming = validateEnvelope(raw);
  const originals = new Map(current.meals.map(meal => [meal.id, meal]));
  for (const meal of incoming.meals) {
    const old = originals.get(meal.id);
    if (old && meal.updatedAt === old.updatedAt && meal.photo.startsWith('data:') && old.photo.startsWith('/api/photos/')) {
      if (await readPhoto(old.photo) === meal.photo) meal.photo = old.photo;
    }
  }
  return mergeRecords(current, incoming);
}
