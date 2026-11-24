const {execFileSync}=require('node:child_process'),fs=require('node:fs');
function evaluate(code){return JSON.parse(execFileSync(process.execPath,['tests/device.cjs','eval',code],{encoding:'utf8',timeout:240000}).trim());}
const director=process.argv.includes('--director');
const result=evaluate(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
 NativeFiles.demo();await wait(1000);document.getElementById('studio-panel').classList.remove('open');
 document.body.classList.remove('controls-hidden');
 const click=()=>document.querySelector('[data-sentence]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
 click();if(!document.body.classList.contains('controls-hidden'))throw Error('显示时单击未隐藏');
 click();if(document.body.classList.contains('controls-hidden'))throw Error('隐藏时单击未显示');
 click();click();checks.push('单击交替隐藏和显示');
 for(const hidden of [true,false]){document.body.classList.toggle('controls-hidden',hidden);if(getComputedStyle(document.getElementById('progress')).display!=='none')throw Error('顶部进度条仍可见');}checks.push('菜单显示及隐藏均无顶部蓝条');
 Studio.director();if(document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('st-close').click();
 const tree=JSON.parse(Android.getFolder()).uri,root=decodeURIComponent(tree.split('/tree/')[1]);
 const uri=n=>tree+'/document/'+encodeURIComponent(root+'/v021/ch'+n+'.md');
 const listing=[1,2,3].map(n=>({uri:uri(n),name:'ch'+n+'.md',path:'v021/ch'+n+'.md',chapter:'第'+n+'章'}));
 App.setFolderList(JSON.stringify(listing));Android.openRecent(uri(1));await wait(700);
 if(${director}){Studio.director();if(!document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('analyze').click();for(let i=0;i<120;i++){await wait(500);const text=document.getElementById('analysis-status').textContent;if(text.includes('分析完成'))break;if(text.includes('失败'))throw Error(text);}document.getElementById('st-close').click();}
 // Save an old position in chapter 2: automatic continuation must ignore it.
 const hash=StudioCore.hash('sentences-v2:# 第2章。\\n\\n继续前进。');NativeReader.put('progress:'+uri(2),JSON.stringify({hash,index:1,offset:1500,plan:null}));
 const transitions=[],starts=[],listener=()=>{transitions.push(Studio.state().doc.uri);if(transitions.length>1&&Studio.state().index!==0)throw Error('自动切章未从首句开始');};
 window.addEventListener('document-ready',listener);const previous=Studio.audioStarted;Studio.audioStarted=()=>{starts.push({uri:Studio.state().doc.uri,index:Studio.state().index});previous();};
 Studio.seek(0,true);App.goHome();
 for(let i=0;i<150;i++){await wait(500);if(StudioCore.sameDocument(Studio.state().doc?.uri,uri(3))&&!Studio.state().active&&Studio.state().index>=Studio.state().segments.length)break;if(document.getElementById('speech-status').textContent.includes('HTTP'))throw Error(document.getElementById('speech-status').textContent);}
 if(!StudioCore.sameDocument(Studio.state().doc?.uri,uri(3))||Studio.state().active)throw Error('未自动连续播完三章：'+document.getElementById('speech-status').textContent);
 const switched=transitions.map(x=>decodeURIComponent(x).match(/ch[123]\\.md/)?.[0]);if(switched.join(',')!=='ch2.md,ch3.md')throw Error('漏切或重复切章：'+switched);
 if(!starts.some(x=>StudioCore.sameDocument(x.uri,uri(2))&&x.index===0))throw Error('第二章未从首句播放');
 checks.push('首页状态连续自动播完三章、无重复切章','下一章忽略旧进度并从首句播放');
 Studio.audioStarted=previous;window.removeEventListener('document-ready',listener);Studio.stop();App.resumeReader();
 return {checks,switched,starts};
})()`);
fs.writeFileSync(director?'evidence/reader-v021-director.json':'evidence/reader-v021.json',JSON.stringify(result,null,2));console.log(result);
