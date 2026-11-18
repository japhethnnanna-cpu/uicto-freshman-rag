import { mentionedSessions } from './sources.mjs';

// Match unresolved knowledge placeholders, not legitimate notices such as
// "School-fee payment is not available". Keep the database guard in sync.
export function unresolvedAnswer(value) {
  return /not\s+verified|not\s+confirmed|not\s+available\s+in\s+the\s+reviewed\s+sources|(?:awaiting|pending|requires?)\s+(?:staff\s+)?(?:confirmation|verification)|to\s+be\s+confirmed|^\s*(?:tbd|todo|n\/?a)\s*[.!]?\s*$/i.test(String(value ?? '').normalize('NFKC'));
}

const sourcePaths = new Map([
  ['uicto.edu.ng', /^\/(?:$|about\/?$|contact\/?$|undergraduate\/programs\/?$|student\/portal\/login\/?$|(?:admission|post-utme)\/(?:procedure|correction)\/?$|portal\/(?:ug\/admission\/status|result\/postutme)\/check\/?$|assets\/pdf\/[a-z0-9-]+\.pdf$|news\/[a-z0-9-]+\/?$)/],
  ['nelf.gov.ng', /^\/faq\/?$/],
  ['www.nuc.edu.ng', /^\/nigerian-univerisities\/state-univerisity\/?$/],
]);

// This validates manually reviewed references, not permission for automated fetching.
export function reviewedSource(value) {
  try {
    const u = new URL(value);
    const host = u.hostname === 'www.uicto.edu.ng' ? 'uicto.edu.ng' : u.hostname;
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash &&
      sourcePaths.get(host)?.test(u.pathname) ? u.href : null;
  } catch { return null; }
}

function day(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = value instanceof Date ? value.toISOString().slice(0,10) : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s).toISOString().slice(0,10) !== s)
    throw Error('Invalid review date');
  return s;
}

export function reviewedRecords(rows, today = new Date().toISOString().slice(0,10)) {
  if (!rows.length || rows.length > 1000) throw Error('Invalid row count');
  const ids = new Set(), claims = new Set();
  const text = (r,k) => String(r[k] ?? '').trim();
  return rows.map((r, i) => {
    const record = {
      external_id: text(r,'ID'),category:text(r,'Category'),question:text(r,'Expected User Query'),
      answer:text(r,'Chatbot Response (Ground Truth)'),source:text(r,'Source URL') || null,
      review_status:text(r,'Review Status'),academic_session:text(r,'Academic Session') || null,
      reviewed_on:day(r['Reviewed On']),expires_on:day(r['Expires On']),claim_key:text(r,'Claim Key'),
    };
    if (!/^Q-\d{3,}$/.test(record.external_id) || ids.has(record.external_id) ||
      !['approved','pending'].includes(record.review_status) || !record.category ||
      !record.question || !record.answer || record.answer.length > 4000 || record.question.length > 800 ||
      !/^[a-z0-9-]+$/.test(record.claim_key) || claims.has(record.claim_key))
      throw Error('Invalid or duplicate reviewed row ' + (i+2));
    ids.add(record.external_id);claims.add(record.claim_key);
    if (record.source && !reviewedSource(record.source)) throw Error('Untrusted source in ' + record.external_id);
    if (record.academic_session && (!/^20\d{2}\/20\d{2}$/.test(record.academic_session) ||
      Number(record.academic_session.slice(5)) !== Number(record.academic_session.slice(0,4))+1))
      throw Error('Invalid academic session');
    if (record.review_status === 'approved') {
      if (!record.source || !record.reviewed_on || record.reviewed_on > today || !record.expires_on ||
        record.expires_on < today || Date.parse(record.expires_on)-Date.parse(record.reviewed_on) > 90*86400000)
        throw Error('Incomplete or expired review in ' + record.external_id);
      if (mentionedSessions(record.question+' '+record.answer).some(s=>s!==record.academic_session))
        throw Error('Session mismatch in ' + record.external_id);
      if (unresolvedAnswer(record.answer))
        throw Error('Unresolved answer must stay pending: ' + record.external_id);
    } else if (record.reviewed_on || record.expires_on) throw Error('Pending row cannot carry approval dates');
    return record;
  });
}
