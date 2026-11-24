"""Explicit opt-in smoke test. Key supplied by environment; never logged or stored."""
import os,json,urllib.request,base64,pathlib,time
root=pathlib.Path(__file__).resolve().parents[1]/'evidence';root.mkdir(exist_ok=True)
def call(path,body=None):
    req=urllib.request.Request('https://api.xiaomimimo.com/v1/'+path,data=json.dumps(body).encode() if body else None,headers={'Authorization':'Bearer '+os.environ['MIMO_TEST_KEY'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=150) as response:return json.load(response)
models=call('models');ids=[m['id'] for m in models.get('data',[])];print('Models:',ids,flush=True)
tts=call('chat/completions',{'model':'mimo-v2.5-tts','messages':[{'role':'user','content':'自然温暖，语速平稳。'},{'role':'assistant','content':'你好，墨声。让文字，在声音中慢慢展开。'}],'audio':{'format':'wav','voice':'茉莉'},'stream':False})
audio=base64.b64decode(tts['choices'][0]['message']['audio']['data']);(root/'mimo-live.wav').write_bytes(audio);print('TTS bytes:',len(audio),flush=True)
model='mimo-v2.5' if 'mimo-v2.5' in ids else next(x for x in ids if 'tts' not in x and 'asr' not in x)
plan=call('chat/completions',{'model':model,'messages':[{'role':'system','content':'你是有声书导演。只返回JSON: {"cast":[{"name":"角色名","gender":"男/女/未知","personality":"性格","voice":"茉莉或白桦","reason":"理由"}],"segments":[{"id":0,"speaker":"角色名","instruction":"语气"}]}。覆盖每个id，选取合适性别音色。'},{'role':'user','content':json.dumps({'segments':[{'id':0,'text':'林岚温柔地说：“你终于回来了。”'},{'id':1,'text':'老人沉稳地说：“先坐下，故事才刚开始。”'}]},ensure_ascii=False)}],'thinking':{'type':'disabled'},'response_format':{'type':'json_object'},'stream':False})
content=plan['choices'][0]['message']['content'];result={'models':ids,'text_model':model,'audio_bytes':len(audio),'audio_header':audio[:4].decode(errors='replace'),'director':json.loads(content)};(root/'live-api-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
