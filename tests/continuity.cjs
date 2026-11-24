const {execFileSync}=require('node:child_process');const fs=require('node:fs');const assert=require('node:assert/strict');
function evaluate(code){return JSON.parse(execFileSync(process.execPath,['tests/device.cjs','eval',code],{encoding:'utf8',timeout:240000}).trim());}
const mode=process.argv[2]||'normal';
const result=evaluate(`(async()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 App.closeOverlays();document.getElementById('st-director').click();if(document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('st-close').click();
 const text=Array.from({length:14},(_,i)=>i%2===0?'林岚温柔地说：“回家的路就在前面。”':'陈远开心地说：“我会一直陪伴着你。”').join('\\n\\n');
 App.render(text,'test:continuity-${mode}','连续听读测试.md');
 let director=null;
 if(${JSON.stringify(mode)}==='director'){
  document.getElementById('st-director').click();document.getElementById('analyze').click();
  for(let i=0;i<180;i++){await sleep(1000);const s=document.getElementById('analysis-status').textContent;if(s.includes('分析完成')){director=s;break;}if(s.includes('失败'))throw Error(s);}
  if(!director)throw Error('导演测试超时');
  if(!document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('st-close').click();
 }
 window.continuity={transitions:[],initial:null};const started=Studio.audioStarted,advance=Studio.audioAdvanced;
 Studio.audioStarted=()=>{continuity.initial=document.getElementById('speech-status').textContent;started();};
 Studio.audioAdvanced=id=>{continuity.transitions.push({id,playing:NativeReader.playing(),position:NativeReader.position(),at:performance.now()});advance(id);};
 document.getElementById('play').click();
 for(let i=0;i<150;i++){await sleep(1000);if(continuity.transitions.length>=2)break;if(document.getElementById('play').textContent.includes('重试'))throw Error(document.getElementById('speech-status').textContent);}
 if(continuity.transitions.length<2)throw Error('没有原生连续切换：'+JSON.stringify(continuity));
 document.getElementById('play').click();await sleep(200);const paused=!NativeReader.playing();
 document.getElementById('listen-progress').value=8;document.getElementById('listen-progress').dispatchEvent(new Event('change'));const count=continuity.transitions.length;await sleep(1500);
 const cancelled=!NativeReader.playing()&&count===continuity.transitions.length;
 Studio.audioStarted=started;Studio.audioAdvanced=advance;
 return {...continuity,director,paused,cancelled};
})()`);
assert.match(result.initial,/已预生成 5 段/);assert.ok(result.transitions.every(t=>t.playing));assert.ok(result.paused);assert.ok(result.cancelled);
fs.writeFileSync('evidence/continuity-'+mode+'.json',JSON.stringify(result,null,2));console.log(mode,result);
