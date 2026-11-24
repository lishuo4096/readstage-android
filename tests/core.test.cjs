const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../app/src/main/assets/studio-core.js');
test('chapter catalog matches tree and standalone URIs, isolates sibling chapters',()=>{
 const root='content://com.android.externalstorage.documents';
 const plain=root+'/document/primary%3ABooks%2Fnovel%2F1.md';
 const tree=root+'/tree/primary%3ABooks/document/primary%3ABooks%2Fnovel%2F1.md';
 assert.ok(C.sameDocument(plain,tree));assert.ok(!C.sameDocument(plain,tree.replace('1.md','2.md')));
 const files=[{uri:tree,name:'1.md',path:'novel/1.md',chapter:'第一章'},{uri:tree.replace('1.md','2.md'),name:'2.md',path:'novel/2.md',chapter:'第二章'},{uri:root+'/document/other',name:'third.md',path:'another/third.md',chapter:'第三章'}];
 assert.deepEqual(C.chapterCatalog(files,plain).map(f=>f.name),['1.md','2.md']);
});
test('chapter sorting recognizes Chinese and Arabic numbers with name fallback',()=>{
 assert.equal(C.chapterNumber('第二十三章 回家'),23);assert.equal(C.chapterNumber('第两百零一章'),201);
 assert.deepEqual(C.sortChapters([{name:'a.md',chapter:'第十章'},{name:'b.md',chapter:'第二章'},{name:'z.md'},{name:'c.md',chapter:'第1章'}]).map(f=>f.name),['c.md','b.md','a.md','z.md']);
});
test('sentences preserve exact character ranges across punctuation and quotations',()=>{
 const text='他**不读标记**。她说：“你好！”\n下一句。';const parts=C.split(text);assert.ok(parts.length>=3);
 for(const p of parts)assert.equal(text.slice(p.start,p.end),p.text);
});
test('director expands ranges, string ids, and repairs only missing original ids',async()=>{
 const cast=[{name:'旁白',voice:'a'}],batch=Array.from({length:12},(_,i)=>({id:i+24})),calls=[];
 const result=await C.directBatch(async(items,existing,error)=>{calls.push(items.map(s=>s.id));return calls.length===1?{cast,segments:[{from:'24',to:'32',speaker:'旁白',instruction:'平静'}]}:{cast:[],segments:items.map(s=>({id:String(s.id),speaker:'旁白',instruction:'连贯'}))};},batch,['a']);
 assert.deepEqual(calls[1],[33,34,35]);assert.deepEqual(result.segments.map(s=>s.id),batch.map(s=>s.id));
 assert.throws(()=>C.reconcile({cast,segments:[{from:24,to:25,speaker:'旁白',instruction:''},{id:25,speaker:'旁白',instruction:''}]},batch,['a']));
});
test('six-slot queue caps concurrency at two, refills and discards cancelled audio',async()=>{
 let running=0,max=0;const pending=[];
 const q=new C.AudioQueue(id=>new Promise(r=>{running++;max=Math.max(max,running);pending.push(()=>{running--;r(id);});}));
 q.fill(0,12);await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);
 for(let i=0;i<3;i++){pending.splice(0).forEach(f=>f());await new Promise(r=>setImmediate(r));}
 assert.equal(q.ready,5);assert.equal(max,2);assert.equal(await q.get(3),3);
 q.fill(1,12);await new Promise(r=>setImmediate(r));assert.equal(q.entries.has(0),false);assert.ok(q.entries.has(6));
 q.reset();pending.splice(0).forEach(f=>f());await new Promise(r=>setImmediate(r));assert.equal(q.ready,0);assert.equal(q.entries.size,0);
});
test('long prose is split without lost text or surrogate breaks',()=>{
 const text=('正文😀。这是一段长文字！'.repeat(140));const parts=C.split(text);
 assert.equal(parts.map(p=>p.text).join(''),text);assert.ok(parts.every(p=>p.text.length<=220));assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p.text)));assert.deepEqual(parts.map(p=>p.id),parts.map((_,i)=>i));
});
test('provider payloads implement three distinct protocols',()=>{
 const m=C.speech('mimo',C.presets.mimo,'原文','白桦','轻声');assert.equal(m.messages[1].role,'assistant');assert.equal(m.audio.voice,'白桦');
 const q=C.speech('qwen',C.presets.qwen,'原文','Cherry','轻声');assert.equal(q.input.instructions,'轻声');assert.equal(q.input.text,'原文');
 const a=C.speech('compatible',C.presets.compatible,'原文','alloy','轻声');assert.equal(a.input,'原文');assert.equal(a.instructions,'轻声');
});
test('director rejects unknown voices, missing ids, duplicates and unknown characters',()=>{
 const batch=[{id:0},{id:1}],cast=[{name:'旁白',voice:'a'}],segments=[{id:0,speaker:'旁白',instruction:'平静'},{id:1,speaker:'旁白',instruction:'缓慢'}];
 assert.equal(C.validate({cast,segments},batch,['a']).segments.length,2);
 assert.throws(()=>C.validate({cast:[{name:'旁白',voice:'b'}],segments},batch,['a']));
 assert.throws(()=>C.validate({cast,segments:segments.slice(0,1)},batch,['a']));
 assert.throws(()=>C.validate({cast,segments:[segments[0],segments[0]]},batch,['a']));
 assert.throws(()=>C.validate({cast,segments:[segments[0],{id:1,speaker:'外人',instruction:''}]},batch,['a']));
});
