// Upload a compressed map image (WebP blob) to the vtt-maps Storage bucket.
// Dedupes by content hash → each identical map is stored once; players fetch
// the public URL (cached by the browser/IndexedDB), keeping egress low.
import { supabase } from '../../../../core/supabase/client';

const BUCKET = 'vtt-maps';

export async function uploadMapImage(campaignId, blob, hash) {
  const path = `${campaignId}/${hash}.webp`;
  // upsert: re-uploading the same content is a no-op overwrite (idempotent).
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp', upsert: true,
  });
  if (error && !/exists/i.test(error.message)) throw error;
  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return { imagePath: path, imageUrl };
}

// Upload a journal/handout image (kept in its original format) to the same
// bucket under a /handouts/ prefix. Returns the public URL + storage path.
export async function uploadHandoutImage(campaignId, file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const id = Math.random().toString(36).slice(2, 10);
  const path = `${campaignId}/handouts/${id}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/png', upsert: true,
  });
  if (error && !/exists/i.test(error.message)) throw error;
  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return { imagePath: path, imageUrl };
}
