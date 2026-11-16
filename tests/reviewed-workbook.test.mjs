import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedRecords,reviewedSource} from '../lib/reviewed-workbook.mjs';
const row={'ID':'Q-001','Category':'Finance','Expected User Query':'How do I pay fees for 2026/2027?',
 'Chatbot Response (Ground Truth)':'The 2026/2027 registration page says fee payment is unavailable.',
 'Review Status':'approved','Academic Session':'2026/2027','Source URL':'https://uicto.edu.ng/admission/procedure',
 'Reviewed On':'2026-11-14','Expires On':'2026-11-21','Claim Key':'school-fee-payment'};
test('reviewed import rejects incomplete reviews, arbitrary sources and wrong-session answers',()=>{
 assert.equal(reviewedRecords([row],'2026-11-14')[0].review_status,'approved');
 for(const change of [{'Source URL':'https://random.example/advice'},{'Expires On':'2026-11-13'},
  {'Reviewed On':''},{'Academic Session':'2025/2026'},{'Chatbot Response (Ground Truth)':'The fee amount is not verified.'}])
   assert.throws(()=>reviewedRecords([{...row,...change}],'2026-11-14'));
 assert.throws(()=>reviewedRecords([row,row],'2026-11-14'));
});
test('pending knowledge remains unpublished and source validation never authorises web fetching',()=>{
 const pending={...row,'Review Status':'pending','Reviewed On':'','Expires On':'','Source URL':''};
 assert.equal(reviewedRecords([pending],'2026-11-14')[0].review_status,'pending');
 assert.ok(reviewedSource('https://nelf.gov.ng/faq'));
 for(const url of ['https://nelf.gov.ng.evil.test/faq','https://user@nelf.gov.ng/faq','http://uicto.edu.ng/contact','https://uicto.edu.ng/contact?next=https://evil.test','javascript:alert(1)'])assert.equal(reviewedSource(url),null);
});
