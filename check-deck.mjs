import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function list(prefix) {
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await s.storage.from('custom-deck-images').list(prefix, { limit: 1000, offset });
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}
const base = 'e7a73bf0-9fa4-4fc3-a4bf-aaacfaa70ad1/3cf8e092-e710-4164-8065-3a62ef32912c';
const top = await list(base);
console.log('Top entries:', top.length);
for (const t of top) console.log(' -', t.name, t.id ? '(file)' : '(folder)');
