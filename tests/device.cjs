/* WebView instrumentation over ADB's debug socket. No external dependencies. */
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9222/json')).json();
 const ws=new WebSocket(pages.find(p=>p.url.includes('viewer.html')).webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let serial=0;const pending=new Map();
 ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}};
 async function call(method,params={}){const id=++serial;return new Promise(r=>{pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result?.result?.value;}
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 if(process.argv[2]==='eval'){console.log(JSON.stringify(await evaluate(process.argv[3])));ws.close();return;}
 if(process.argv[2]==='drag-orb'){
  const before=await evaluate("(()=>{const r=document.getElementById('speech-orb').getBoundingClientRect();return {x:r.x+35,y:r.y+35}})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:before.x,y:before.y,button:'left',buttons:1,clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x-100,y:before.y-150,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:before.x-100,y:before.y-150,button:'left',buttons:0,clickCount:1});
  console.log(await evaluate("NativeReader.get('orb-position')"));ws.close();return;
 }
 if(process.argv[2]==='workspace'){
  const result=await evaluate(`(async()=>{
   const wait=()=>new Promise(r=>setTimeout(r,800));
   App.closeOverlays();App.goHome();await wait();
   const names=Array.from(document.querySelectorAll('#folder-list .ri-name')).map(e=>e.textContent);
   if(!names.includes('one.md')||!names.includes('two.md'))throw Error('Workspace file list missing');
   const open=async name=>{App.goHome();await wait();Array.from(document.querySelectorAll('#folder-list .ri-name')).find(e=>e.textContent===name).parentElement.click();await wait();};
   await open('one.md');window.scrollTo(0,650);await wait();
   document.getElementById('listen-progress').value=3;document.getElementById('listen-progress').dispatchEvent(new Event('change'));await wait();
   await open('two.md');window.scrollTo(0,1000);await wait();
   await open('one.md');await wait();
   const restored={scroll:window.scrollY,listen:+document.getElementById('listen-progress').value};
   if(restored.scroll<400||restored.listen!==3)throw Error('Per-file progress not restored '+JSON.stringify(restored));
   NativeFiles.create('created-by-test.md');await wait();
   if(!document.getElementById('title').textContent.includes('created-by-test'))throw Error('Create failed');
   document.getElementById('st-edit').click();document.getElementById('editor').value='# SAF test\\n原文件写入成功';document.getElementById('editor').dispatchEvent(new Event('input'));document.getElementById('edit-save').click();await wait();Android.reloadCurrent();await wait();
   if(!document.getElementById('content').textContent.includes('原文件写入成功'))throw Error('SAF save failed');
   return {names,restored,created:true,saved:true};
  })()`);
  fs.writeFileSync('evidence/workspace-result.json',JSON.stringify(result,null,2));console.log(result);ws.close();return;
 }
 const results=[];async function check(name,fn){await fn();results.push(name);console.log('PASS',name);}
 await check('extension loaded',async()=>assert.equal(await evaluate('typeof Studio.audioDone'),'function'));
 await evaluate("document.getElementById('open-demo').click()");await sleep(1800);
 await check('offline Markdown GFM math Mermaid',async()=>{const data=await evaluate(`({title:document.getElementById('title').textContent,table:!!document.querySelector('#content table'),math:!!document.querySelector('#content .katex'),mermaid:!!document.querySelector('#content .mermaid svg')})`);assert.ok(data.title.includes('使用指南'));assert.ok(data.table);assert.ok(data.math);assert.ok(data.mermaid);});
 await evaluate(`document.getElementById('st-edit').click();document.getElementById('editor').value+='\\n\\n## Device test\\n已通过设备编辑测试。';document.getElementById('editor').dispatchEvent(new Event('input'));document.getElementById('edit-save').click()`);await sleep(500);
 await check('edit and write original file',async()=>assert.ok((await evaluate("document.getElementById('content').textContent")).includes('已通过设备编辑测试')));
 await evaluate('Android.reloadCurrent()');await sleep(800);
 await check('reload retains file edit',async()=>assert.ok((await evaluate("document.getElementById('content').textContent")).includes('已通过设备编辑测试')));
 await evaluate(`NativeReader.put('draft:test:blank','""');App.render('old text','test:blank','空白草稿.md')`);
 await check('empty draft is preserved',async()=>assert.equal((await evaluate("document.getElementById('content').textContent")).trim(),''));
 await evaluate("NativeReader.put('draft:test:blank','null');NativeFiles.demo()");await sleep(700);
 await evaluate('window.scrollTo(0,650)');await sleep(600);await evaluate('App.goHome()');await evaluate('NativeFiles.demo()');await sleep(1500);
 await check('per file scroll restoration',async()=>assert.ok(await evaluate('window.scrollY>400')));
 await check('sanitizer blocks event handlers and script URLs',async()=>assert.equal(await evaluate(`DOMPurify.sanitize('<img src=x onerror="NativeReader.get(1)"><a href="javascript:alert(1)">x</a>').includes('onerror')`),false));
 if(process.env.MIMO_TEST_KEY){
  await evaluate(`document.getElementById('st-settings').click();document.getElementById('key').value=${JSON.stringify(process.env.MIMO_TEST_KEY)};document.getElementById('director-key').value=${JSON.stringify(process.env.MIMO_TEST_KEY)};document.getElementById('director-model').value='mimo-v2.6-flash';document.getElementById('save-config').click();document.getElementById('st-close').click()`);
  await check('keys stored with Android Keystore',async()=>assert.ok(await evaluate("NativeReader.hasKey('mimo')&&NativeReader.hasKey('director')")));
  // Analyze a short, role-rich selection through the actual Android networking bridge.
  await evaluate(`App.render('# 选角测试\\n\\n林岚温柔地说：“你终于回来了。”\\n\\n老人沉稳地说：“先坐下，故事才刚开始。”','test:director','选角测试.md');document.getElementById('st-director').click();document.getElementById('analyze').click()`);
  let message='';for(let i=0;i<100;i++){await sleep(1000);message=await evaluate("document.getElementById('analysis-status').textContent");if(message.includes('分析完成')||message.includes('失败'))break;}
  await check('real director API on Android',async()=>assert.ok(message.includes('分析完成'),message));
  await evaluate("if(!document.getElementById('director-enabled').checked)document.getElementById('director-enabled').click();document.getElementById('st-close').click();document.getElementById('listen-progress').value=1;document.getElementById('listen-progress').dispatchEvent(new Event('change'));document.getElementById('play').click()");
  for(let i=0;i<60;i++){await sleep(1000);if(await evaluate('NativeReader.playing()'))break;}
  await check('real synthesized audio played by foreground service',async()=>assert.ok(await evaluate('NativeReader.playing()')));
  await sleep(400);await evaluate("document.getElementById('play').click()");await sleep(100);
  await check('pause retains segment time',async()=>assert.ok(await evaluate('NativeReader.position()>0&&!NativeReader.playing()')));
  await evaluate("document.getElementById('st-director').click()");
 }
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('evidence/device-webview.png',Buffer.from(screenshot.result.data,'base64'));
 fs.writeFileSync('evidence/device-result.json',JSON.stringify({time:new Date().toISOString(),passed:results},null,2));ws.close();
})().catch(e=>{console.error(e);process.exit(1);});
