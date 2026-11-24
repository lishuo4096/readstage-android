(function(root){
 'use strict';
 const presets={
  mimo:{endpoint:'https://api.xiaomimimo.com/v1/chat/completions',model:'mimo-v2.5-tts',voice:'mimo_default',voices:'mimo_default|默认|未知|自然叙述\n冰糖|冰糖|女|明亮活泼\n茉莉|茉莉|女|温柔平静\n苏打|苏打|男|年轻清爽\n白桦|白桦|男|沉稳\nMia|Mia|女|英文\nChloe|Chloe|女|英文\nMilo|Milo|男|英文\nDean|Dean|男|英文'},
  qwen:{endpoint:'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-instruct-flash',voice:'Cherry',voices:'Cherry|芊悦|女|阳光亲切\nSerena|苏瑶|女|温柔\nEthan|晨煦|男|沉稳\nChelsie|千雪|女|自然\nDylan|北京小爷|男|爽朗\nJada|沪上阿姐|女|上海方言\nSunny|甜茶|女|甜美'},
  compatible:{endpoint:'https://api.openai.com/v1/audio/speech',model:'gpt-4o-mini-tts',voice:'alloy',voices:'alloy|Alloy|未知|中性\nash|Ash|男|自然\ncoral|Coral|女|温暖\necho|Echo|男|沉稳\nfable|Fable|未知|叙事\nnova|Nova|女|明亮\nonyx|Onyx|男|低沉\nshimmer|Shimmer|女|柔和'}
 };
 function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
 function split(text,max=220){const out=[];const pattern=/[^。！？!?；;\n]+[。！？!?；;]*(?:[”」』"']*)|[。！？!?；;]+/g;let match;
  while((match=pattern.exec(text))){let raw=match[0],base=match.index;while(raw.length){let end=Math.min(max,raw.length);if(/[\uD800-\uDBFF]/.test(raw[end-1]))end--;const piece=raw.slice(0,end),value=piece.trim();if(value){const start=base+piece.indexOf(value);out.push({id:out.length,text:value,start,end:start+value.length});}raw=raw.slice(end);base+=end;}}
  return out;
 }
 function chapterNumber(name){const m=String(name).match(/第\s*([零〇一二两三四五六七八九十百千万\d]+)\s*[章节回卷]/);if(!m)return null;const v=m[1];if(/^\d+$/.test(v))return +v;let total=0,section=0,n=0;const digits='零一二三四五六七八九';for(const ch of v){if(ch==='两')n=2;else if(ch==='〇')n=0;else if(digits.includes(ch))n=digits.indexOf(ch);else {const unit={十:10,百:100,千:1000,万:10000}[ch];if(unit===10000){total+=(section+n)*unit;section=0;n=0;}else {section+=(n||1)*unit;n=0;}}}return total+section+n;}
 function sortChapters(files){return [...files].sort((a,b)=>{const x=chapterNumber(a.chapter||a.name),y=chapterNumber(b.chapter||b.name);return x!==null&&y!==null?x-y||a.name.localeCompare(b.name,'zh-CN',{numeric:true}):x!==null?-1:y!==null?1:a.name.localeCompare(b.name,'zh-CN',{numeric:true});});}

 function voices(raw){return raw.split('\n').filter(x=>x.trim()).map(x=>{const [id,name,gender,traits]=x.split('|').map(y=>y.trim());return {id,name:name||id,gender:gender||'未知',traits:traits||''};});}
 function speech(provider,c,text,voice,instructions){
  if(provider==='mimo')return {model:c.model,messages:[...(instructions?[{role:'user',content:instructions}]:[]),{role:'assistant',content:text}],audio:{format:'wav',voice},stream:false};
  if(provider==='qwen')return {model:c.model,input:{text,voice,language_type:'Auto',...(instructions&&c.model.includes('instruct')?{instructions,optimize_instructions:false}:{})}};
  return {model:c.model,input:text,voice,response_format:'wav',...(instructions?{instructions}:{})};
 }
 function reconcile(plan,batch,allowed,existing=[]){
  if(!Array.isArray(plan.cast)||!Array.isArray(plan.segments))throw Error('导演结果缺少 cast 或 segments');
  const cast=new Map(existing.map(c=>[c.name,c]));for(const c of plan.cast){if(typeof c.name!=='string'||!c.name||!allowed.includes(c.voice))throw Error('导演返回了无效角色或音色');cast.set(c.name,cast.get(c.name)||c);}
  const ids=new Set(batch.map(s=>s.id)),seen=new Map();
  const integer=v=>{if((typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''||!Number.isInteger(Number(v)))throw Error('导演编号无效');return Number(v);};
  for(const s of plan.segments){const from=integer(s.id??s.from),to=s.id!=null?from:integer(s.to);if(to<from||to-from>batch.length)throw Error('导演范围越界');
   if(!cast.has(s.speaker)||typeof s.instruction!=='string'||s.instruction.length>800)throw Error('导演角色或语气无效');
   for(let id=from;id<=to;id++){if(!ids.has(id)||seen.has(id))throw Error('导演编号越界或重复：'+id);seen.set(id,{id,speaker:s.speaker,instruction:s.instruction});}
  }
  return {cast:[...cast.values()],segments:batch.filter(s=>seen.has(s.id)).map(s=>seen.get(s.id)),missing:batch.filter(s=>!seen.has(s.id))};
 }
 function validate(plan,batch,allowed){const r=reconcile(plan,batch,allowed);if(r.missing.length)throw Error('导演缺少段落 ID：'+r.missing.map(s=>s.id).join(','));return {cast:r.cast,segments:r.segments};}
 async function directBatch(ask,batch,allowed,existing=[]){
  let cast=existing,parts=[],missing=batch,error='';
  for(let attempt=0;attempt<3&&missing.length;attempt++){
   try{const r=reconcile(await ask(missing,cast,error),missing,allowed,cast);cast=r.cast;parts.push(...r.segments);missing=r.missing;error='只补齐这些原始 ID：'+missing.map(s=>s.id).join(',');}
   catch(e){error=e.message;}
  }
  for(const item of missing){const r=reconcile(await ask([item],cast,'仅返回这个原始 ID：'+item.id),[item],allowed,cast);if(r.missing.length)throw Error('导演仍缺少 ID：'+item.id);cast=r.cast;parts.push(...r.segments);}
  return validate({cast,segments:parts},batch,allowed);
 }
 /** Bounded lookahead, same six-slot/two-request scale as the PC reader. */
 class AudioQueue{
  constructor(synthesize,changed=()=>{}){this.synthesize=synthesize;this.changed=changed;this.reset();}
  reset(){if(this.entries)for(const e of this.entries.values())if(e.state!=='ready'&&e.state!=='error')e.reject(Error('已取消'));this.generation=(this.generation||0)+1;this.entries=new Map();this.running=0;this.cursor=0;this.length=0;}
  fill(cursor,length){this.cursor=cursor;this.length=length;for(const id of this.entries.keys())if(id<cursor)this.entries.delete(id);
   for(let id=cursor;id<Math.min(length,cursor+6);id++)if(!this.entries.has(id)){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});this.entries.set(id,{promise,resolve,reject,state:'queued'});}this.pump();}
  pump(){const generation=this.generation;for(const[id,e]of this.entries){if(this.running>=2)break;if(e.state!=='queued')continue;e.state='loading';this.running++;
    Promise.resolve().then(()=>generation===this.generation?this.synthesize(id):Promise.reject(Error('已取消'))).then(data=>{if(generation!==this.generation)return;e.state='ready';e.resolve(data);},err=>{if(generation!==this.generation)return;e.state='error';e.error=err;e.reject(err);}).finally(()=>{if(generation!==this.generation)return;this.running--;this.changed();this.pump();});
   }}
  get(id){return this.entries.get(id).promise;}
  get ready(){return [...this.entries].filter(([id,e])=>id>this.cursor&&e.state==='ready').length;}
 }
 function documentKey(uri){try{const u=new URL(uri);const marker='/document/',at=u.pathname.lastIndexOf(marker);if(u.protocol==='content:'&&at>=0)return u.host+':'+decodeURIComponent(u.pathname.slice(at+marker.length));return u.href;}catch{return uri||'';}}
 function sameDocument(a,b){return !!a&&!!b&&documentKey(a)===documentKey(b);}
 function chapterCatalog(files,uri){const current=files.find(f=>sameDocument(f.uri,uri));if(!current)return [];const parent=(current.path||current.name).split('/').slice(0,-1).join('/');return sortChapters(files.filter(f=>(f.path||f.name).split('/').slice(0,-1).join('/')===parent));}
 root.StudioCore={documentKey,sameDocument,chapterCatalog,chapterNumber,sortChapters,presets,hash,split,voices,speech,validate,reconcile,directBatch,AudioQueue};
 if(typeof module!=='undefined')module.exports=root.StudioCore;
})(typeof window!=='undefined'?window:globalThis);
