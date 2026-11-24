package com.phil.mdreader;

import android.app.Activity;
import android.content.*;
import android.webkit.*;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.net.*;
import java.io.*;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.util.concurrent.*;

/** Native IO boundary. Keys never enter the Markdown renderer. */
public final class ReaderBridge {
    private final Activity activity;
    private final WebView web;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newFixedThreadPool(2);
    private final ConcurrentHashMap<String,Future<?>> speechTasks=new ConcurrentHashMap<>();
    private static final java.util.Set<HttpURLConnection> speechConnections=ConcurrentHashMap.newKeySet();
    private static final ThreadLocal<Boolean> isSpeech=ThreadLocal.withInitial(()->false);
    ReaderBridge(Activity a, WebView w) { activity=a; web=w; prefs=a.getSharedPreferences("reader",0); PlaybackProxy.attach(a,w); }
    void emit(String js) { activity.runOnUiThread(()->web.evaluateJavascript(js,null)); }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if(!ks.containsAlias("readstage")) {
            KeyGenerator gen=KeyGenerator.getInstance("AES","AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder("readstage",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build());gen.generateKey();
        }
        return (javax.crypto.SecretKey)ks.getKey("readstage",null);
    }
    private String secret(String slot) throws Exception {
        String raw=prefs.getString("secret-"+slot,""); if(raw.isEmpty()) throw new Exception("请先保存 API Key");
        String[] parts=raw.split(":"); Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],2)));
        return new String(c.doFinal(Base64.decode(parts[1],2)),"UTF-8");
    }
    @JavascriptInterface public String saveKey(String slot,String value) {
        try { if(value.isEmpty())return ""; Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
            prefs.edit().putString("secret-"+slot,Base64.encodeToString(c.getIV(),2)+":"+Base64.encodeToString(c.doFinal(value.trim().getBytes("UTF-8")),2)).apply();return "";
        }catch(Exception e){return "系统密钥保存失败";}
    }
    @JavascriptInterface public boolean hasKey(String slot){ return prefs.contains("secret-"+slot); }
    @JavascriptInterface public String get(String name){return prefs.getString(name,"");}
    @JavascriptInterface public void put(String name,String value){if(!name.startsWith("secret-"))prefs.edit().putString(name,value).apply();}
    @JavascriptInterface public void request(String id,String slot,String address,String payload,String mode){
        Future<?> task=worker.submit(()->{isSpeech.set(!mode.equals("json"));try{
            byte[] bytes=null;
            for(int attempt=0;attempt<3;attempt++){
                try{bytes=http(address,payload,secret(slot));break;}
                catch(Exception e){boolean retry=e instanceof java.io.IOException || e instanceof ApiError && (((ApiError)e).code==429 || ((ApiError)e).code>=500);
                    if(!retry||attempt==2||Thread.currentThread().isInterrupted())throw e;
                    emit("Studio.retrying("+JSONObject.quote("API 暂时失败，正在重试 "+(attempt+1)+"/2："+e.getMessage())+")");Thread.sleep((attempt+1)*1000L);
                }
            }
            if(mode.equals("mimo"))bytes=Base64.decode(new JSONObject(new String(bytes,"UTF-8")).getJSONArray("choices").getJSONObject(0).getJSONObject("message").getJSONObject("audio").getString("data"),0);
            if(mode.equals("qwen")){
                String url=new JSONObject(new String(bytes,"UTF-8")).getJSONObject("output").getJSONObject("audio").getString("url");
                bytes=http(url.replaceFirst("^http:","https:"),null,null);
            }
            String result=mode.equals("json")?new String(bytes,"UTF-8"):Base64.encodeToString(bytes,2);
            emit("Studio.resolve("+JSONObject.quote(id)+","+JSONObject.quote(result)+",null)");
        }catch(Exception e){emit("Studio.resolve("+JSONObject.quote(id)+",null,"+JSONObject.quote(e.getMessage()==null?"请求失败":e.getMessage())+")");}finally{isSpeech.remove();speechTasks.remove(id);}});
        if(!mode.equals("json"))speechTasks.put(id,task);
    }
    @JavascriptInterface public void cancelSpeech(){for(Future<?> task:speechTasks.values())task.cancel(true);speechTasks.clear();for(HttpURLConnection c:speechConnections)c.disconnect();speechConnections.clear();}
    static byte[] http(String address,String body,String token)throws Exception{
        URL url=new URL(address); if(!url.getProtocol().equals("https")||url.getUserInfo()!=null)throw new Exception("API 地址必须使用 HTTPS");
        HttpURLConnection conn=(HttpURLConnection)url.openConnection();conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(8000);conn.setReadTimeout(isSpeech.get()?20000:60000);
        if(isSpeech.get())speechConnections.add(conn);
        try {
            if(body!=null){conn.setRequestMethod("POST");conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json");}
            if(token!=null)conn.setRequestProperty("Authorization","Bearer "+token);
            if(body!=null)try(OutputStream out=conn.getOutputStream()){out.write(body.getBytes("UTF-8"));}
            int code=conn.getResponseCode();if(code<200||code>=300)throw new ApiError(code,"HTTP "+code+"："+(code==401||code==403?"密钥或权限错误":code==429?"请求限流或额度不足":"API 请求失败，请检查模型和音色"));
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>28*1024*1024)throw new Exception("响应超过限制");}return out.toByteArray();
            }
        } finally {speechConnections.remove(conn);conn.disconnect();}
    }
    private static class ApiError extends Exception{final int code;ApiError(int c,String m){super(m);code=c;}}
    @JavascriptInterface public void play(String data,int offset,String title){activity.runOnUiThread(()->{
        try{File f=File.createTempFile("speech-",".wav",activity.getCacheDir());try(FileOutputStream out=new FileOutputStream(f)){out.write(Base64.decode(data,0));}
            Intent i=new Intent(activity,PlaybackService.class).putExtra("session",++PlaybackProxy.session).putExtra("path",f.getPath()).putExtra("offset",offset).putExtra("title",title).putExtra("rate",PlaybackProxy.rate);
            PlaybackProxy.running=true;activity.startForegroundService(i);
        }catch(Exception e){emit("Studio.audioError('无法播放音频')");}
    });}
    @JavascriptInterface public void pause(){activity.runOnUiThread(()->PlaybackProxy.command(activity,"pause"));}
    @JavascriptInterface public void queueNext(String data,int segment,String title){activity.runOnUiThread(()->{
        try{File f=File.createTempFile("next-",".wav",activity.getCacheDir());try(FileOutputStream out=new FileOutputStream(f)){out.write(Base64.decode(data,0));}
            if(PlaybackProxy.running)activity.startService(PlaybackProxy.intent(activity,"queue").putExtra("path",f.getPath()).putExtra("segment",segment));else f.delete();
        }catch(Exception e){/* The JS audio cache remains available for the regular advance path. */}
    });}
    @JavascriptInterface public void resume(){activity.runOnUiThread(()->PlaybackProxy.command(activity,"resume"));}
    @JavascriptInterface public void stop(){activity.runOnUiThread(()->PlaybackProxy.stop(activity));}
    @JavascriptInterface public int duration(){return PlaybackProxy.duration;}
    @JavascriptInterface public int position(){return PlaybackProxy.position;}
    @JavascriptInterface public boolean playing(){return PlaybackProxy.playing;}
    @JavascriptInterface public void speed(float value){PlaybackProxy.rate=Math.max(.5f,Math.min(2f,value));activity.runOnUiThread(()->{if(PlaybackProxy.running)activity.startService(PlaybackProxy.intent(activity,"rate").putExtra("rate",PlaybackProxy.rate));});}
}
