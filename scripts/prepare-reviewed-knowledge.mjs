import {config} from 'dotenv';
import XLSX from 'xlsx';
import * as workbookFs from 'node:fs';
XLSX.set_fs(workbookFs);
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {database,embed} from '../lib/providers.mjs';
import {reviewedRecords} from '../lib/reviewed-workbook.mjs';

config({path:'.env.local',quiet:true});
const path=process.argv.slice(2).find(a=>!a.startsWith('--')) ?? 'data/UICTO_Reviewed_Knowledge.xlsx';
const prepare=process.argv.includes('--prepare');
const fields=['external_id','category','question','answer','source','review_status','academic_session','reviewed_on','expires_on','claim_key'];
try {
  if ((await fs.stat(path)).size>2_000_000) throw Error('Workbook too large');
  const book=XLSX.readFile(path,{cellDates:true,sheetRows:1002});
  const rows=reviewedRecords(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]));
  const report={rows:rows.length,approved:rows.filter(r=>r.review_status==='approved').length,pending:rows.filter(r=>r.review_status==='pending').length};
  if (!prepare) { console.log({...report,mode:'validation only; no network or writes'}); process.exit(0); }
  const db=database();
  const {data:prior,error}=await db.from('school_knowledge').select('*').order('external_id');
  if(error)throw Error('Database snapshot failed');
  if(prior.length>1000)throw Error('Snapshot exceeds review limit');
  const folder='data/knowledge-backups/'+new Date().toISOString().replace(/[:.]/g,'-');
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(folder+'/before.json',JSON.stringify(prior,null,2));
  await fs.copyFile(path,folder+'/reviewed-input.xlsx');
  const old=new Map(prior.map(r=>[r.external_id,r]));
  let embeddings=0;
  // Cache prepared vectors before any database mutation. Partial preparation is never applied.
  const prepared=[];
  for (const r of rows) {
    const previous=old.get(r.external_id);
    let embedding=null;
    if(r.review_status==='approved'){
      if(previous?.embedding && previous.question===r.question && previous.answer===r.answer && previous.review_status==='approved')
        embedding=typeof previous.embedding==='string'?JSON.parse(previous.embedding):previous.embedding;
      else {embedding=await embed(`Category: ${r.category}\nQuestion: ${r.question}`);embeddings++;}
    }
    prepared.push({...r,embedding});
    if(prepared.length%10===0)console.log({prepared:prepared.length,total:rows.length,embeddings});
  }
  const snapshot=prior.map(r=>Object.fromEntries(fields.map(f=>[f,r[f]??null])));
  const tag='review_'+randomUUID().replaceAll('-','');
  const literal=value=>'$'+tag+'$'+JSON.stringify(value)+'$'+tag+'$';
  const entries=fields.map(f=>`'${f}',k.${f}`).join(',');
  const query=`begin;
set local search_path=pg_catalog,public,extensions;
set local lock_timeout='5s';
lock table public.school_knowledge in share row exclusive mode;
do $guard$ begin
 if (select coalesce(jsonb_agg(jsonb_build_object(${entries}) order by k.external_id),'[]'::jsonb) from public.school_knowledge k) <> ${literal(snapshot)}::jsonb then
   raise exception 'Knowledge changed after snapshot; prepare again';
 end if;
end $guard$;
insert into public.school_knowledge (${fields.join(',')},embedding)
select ${fields.map(f=>'r.'+f).join(',')},case when r.embedding='null'::jsonb or r.embedding is null then null else r.embedding::text::vector(768) end
from jsonb_to_recordset(${literal(prepared)}::jsonb) as r(external_id text,category text,question text,answer text,source text,review_status text,academic_session text,reviewed_on date,expires_on date,claim_key text,embedding jsonb)
on conflict(external_id) do update set ${fields.filter(f=>f!=='external_id').map(f=>`${f}=excluded.${f}`).join(',')},embedding=excluded.embedding;
commit;
select review_status,count(*) from public.school_knowledge group by review_status;`;
  await fs.writeFile(folder+'/apply.sql',query);
  await fs.writeFile(folder+'/prepared.json',JSON.stringify(prepared));
  console.log({...report,embeddings,mode:'prepared only; no database writes',sql:folder+'/apply.sql',backup:folder+'/before.json'});
}catch(e){console.error('Reviewed import stopped:',e.message);process.exitCode=1;}
