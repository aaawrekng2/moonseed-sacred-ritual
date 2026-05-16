import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SRC_USER = '615ed385-1cb2-407f-8a62-a6806023c4a6';
const SRC_DECK = '33bbb399-745f-4a78-a1bc-30121ccfa2e5';
const DST_USER = 'e7a73bf0-9fa4-4fc3-a4bf-aaacfaa70ad1';
const DST_DECK = crypto.randomUUID();
const BUCKET = 'custom-deck-images';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(url, key, { auth: { persistSession: false } });

const srcPrefix = `${SRC_USER}/${SRC_DECK}/`;
const dstPrefix = `${DST_USER}/${DST_DECK}/`;

// List all objects under source prefix via SQL (recursive list is tricky via SDK)
async function listAll() {
  const { data, error } = await supa.rpc('exec_sql_noop'); // placeholder
  // Use storage.list with pagination
  const out = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supa.storage.from(BUCKET).list(`${SRC_USER}/${SRC_DECK}`, {
      limit: pageSize, offset,
    });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const o of data) out.push(o.name);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

const files = await listAll();
console.log(`Found ${files.length} files`);

let copied = 0, failed = 0;
for (const f of files) {
  const src = `${srcPrefix}${f}`;
  const dst = `${dstPrefix}${f}`;
  const { error } = await supa.storage.from(BUCKET).copy(src, dst);
  if (error) { failed++; console.error('copy fail', f, error.message); }
  else copied++;
}
console.log(`Copied ${copied}, failed ${failed}`);
console.log('NEW_DECK_ID=' + DST_DECK);
