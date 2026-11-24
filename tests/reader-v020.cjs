const {execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
function evaluate(code){return JSON.parse(execFileSync(process.execPath,['tests/device.cjs','eval',code],{encoding:'utf8',timeout:180000}).trim());}
const result=evaluate(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
 App.goHome();await wait(800);if(document.querySelectorAll('#library-items .chapter-file').length)throw Error('首页平铺了文件');checks.push('首页只显示工作区文件夹');
 if(document.querySelector('#library-items .book-folder')){document.querySelector('#library-items .book-folder').click();await wait(1500);if(!document.querySelector('#library-items .chapter-file'))throw Error('进入工作区未列出文件');checks.push('进入文件夹显示章节');}
 NativeFiles.demo();await wait(1300);const state=Studio.state();if(!document.querySelector('[data-sentence]'))throw Error('缺少句子映射');
 checks.push('Markdown 正文逐句映射');
 document.getElementById('novel-settings').click();document.getElementById('novel-director').click();if(document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('st-close').click();
 App.render('# 第十二章 回家\\n\\n'+Array.from({length:12},(_,i)=>'第'+i+'句，夜色落在山间，大家沿着河岸慢慢走回家，远处传来温暖的呼唤。').join('\\n\\n'),'test:novel-ui','第十二章.md');
 const first=Studio.audioStarted;window.startup=null;Studio.audioStarted=()=>{window.startup={buffer:Studio.state().buffered,at:performance.now()};first();};
 document.getElementById('novel-play').click();for(let i=0;i<90&&!startup;i++)await wait(500);if(!startup)throw Error(document.getElementById('speech-status').textContent);
 if(startup.buffer>=5)throw Error('仍然等待满缓存');checks.push('首句就绪播放，未等待五段');await wait(400);
 if(!document.querySelector('.speaking-sentence'))throw Error('缺少朗读高亮');checks.push('柔黄色当前句高亮');
 const before=NativeReader.position();Studio.director();await wait(500);if(!Studio.state().active||!NativeReader.playing())throw Error('导演页面中断听读');document.getElementById('st-close').click();App.goHome();await wait(600);if(!Studio.state().active||!NativeReader.playing())throw Error('首页中断听读');checks.push('导演与首页切换不中断');
 if(document.getElementById('speech-orb').hidden)throw Error('首页没有浮窗');document.getElementById('speech-orb').dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,clientX:20,clientY:20}));document.getElementById('speech-orb').dispatchEvent(new PointerEvent('pointerup',{pointerId:2,clientX:20,clientY:20}));
 App.resumeReader();document.getElementById('studio-panel').classList.remove('open');checks.push('圆环浮窗保留听读会话');
 document.getElementById('content').dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(5500);if(!document.body.classList.contains('controls-hidden'))throw Error('控制栏未自动隐藏');document.getElementById('content').dispatchEvent(new MouseEvent('click',{bubbles:true}));if(document.body.classList.contains('controls-hidden'))throw Error('点击未恢复菜单');checks.push('底栏隐藏与点击唤回');
 const sentence=document.querySelector('[data-sentence="8"]');sentence.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:100,clientY:300}));await wait(650);if(document.getElementById('read-from-here').hidden)throw Error('缺少长按操作');sentence.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));checks.push('长按从此处听读');
 document.getElementById('content').dispatchEvent(new Event('touchmove',{bubbles:true}));window.scrollTo(0,1000);const manual=window.scrollY;await wait(2000);if(Math.abs(window.scrollY-manual)>50)throw Error('手动滚动被立即抢回');checks.push('手动滚动暂缓跟随');await wait(6500);const mark=document.querySelector('.speaking-sentence');if(mark){const rect=mark.getBoundingClientRect();if(rect.top<0||rect.top>innerHeight*.8)throw Error('未恢复自动跟随');}checks.push('空闲八秒恢复跟随');
 Studio.stop();Studio.audioStarted=first;
 const apiError=await new Promise(resolve=>{const old=Studio.resolve;const started=performance.now();Studio.resolve=(id,value,error)=>{if(id==='bad-api'){Studio.resolve=old;resolve({error,ms:performance.now()-started});}else old(id,value,error);};NativeReader.request('bad-api','mimo','https://api.xiaomimimo.com/v1/chat/completions',JSON.stringify({model:'nonexistent-readstage-test',messages:[{role:'user',content:'test'}]}),'json');});
 if(!apiError.error||!apiError.error.includes('HTTP'))throw Error('API 错误没有即时返回');checks.push('API HTTP 错误直接返回');
 return {checks,startup,apiError};
})()`);
fs.writeFileSync('evidence/reader-v020.json',JSON.stringify(result,null,2));console.log(result);
