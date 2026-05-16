import { createClient } from '@supabase/supabase-js';
const SRC_USER='615ed385-1cb2-407f-8a62-a6806023c4a6';
const SRC_DECK='33bbb399-745f-4a78-a1bc-30121ccfa2e5';
const DST_USER='e7a73bf0-9fa4-4fc3-a4bf-aaacfaa70ad1';
const DST_DECK='3cf8e092-e710-4164-8065-3a62ef32912c';
const BUCKET='custom-deck-images';
const supa=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const out=[];let offset=0;
while(true){const {data,error}=await supa.storage.from(BUCKET).list(`${SRC_USER}/${SRC_DECK}`,{limit:1000,offset});if(error)throw error;if(!data||data.length===0)break;for(const o of data)out.push(o.name);if(data.length<1000)break;offset+=1000;}
console.log('src files',out.length);
const existing=new Set();let off2=0;
while(true){const {data,error}=await supa.storage.from(BUCKET).list(`${DST_USER}/${DST_DECK}`,{limit:1000,offset:off2});if(error)throw error;if(!data||data.length===0)break;for(const o of data)existing.add(o.name);if(data.length<1000)break;off2+=1000;}
console.log('already',existing.size);
let copied=0,failed=0;
for(const f of out){if(existing.has(f))continue;const {error}=await supa.storage.from(BUCKET).copy(`${SRC_USER}/${SRC_DECK}/${f}`,`${DST_USER}/${DST_DECK}/${f}`);if(error){failed++;console.error('fail',f,error.message);}else copied++;}
console.log('copied',copied,'failed',failed);
