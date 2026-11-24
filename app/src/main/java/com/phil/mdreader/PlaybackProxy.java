package com.phil.mdreader;
import android.content.*;
import android.os.Build;
import android.webkit.WebView;
/** UI-side IPC endpoint; the MediaPlayer and focus live in :reader. */
final class PlaybackProxy {
 static volatile int position,duration;static volatile boolean playing,running;static float rate=1;static int session=0;
 private static BroadcastReceiver receiver;
 private static int acknowledgedDone=-1,pendingDone=-1;
 static void attach(Context context,WebView web){Context app=context.getApplicationContext();if(receiver!=null)app.unregisterReceiver(receiver);
  receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){
   if(i.getIntExtra("session",-1)!=session)return;
   position=i.getIntExtra("position",0);duration=i.getIntExtra("duration",0);playing=i.getBooleanExtra("playing",false);running=i.getBooleanExtra("running",false);
   String event=i.getStringExtra("event"),js=null;
   if("started".equals(event))js="Studio.audioStarted()";
   if("advanced".equals(event))js="Studio.audioAdvanced("+i.getIntExtra("segment",0)+")";
   if("done".equals(event)){
    final int endedSession=session;
    if(acknowledgedDone==endedSession){c.startService(intent(c,"ack-done"));return;}
    if(pendingDone==endedSession)return;
    pendingDone=endedSession;
    web.evaluateJavascript("typeof Studio!=='undefined'&&(Studio.audioDone(),true)",value->{
     if(pendingDone==endedSession)pendingDone=-1;
     if("true".equals(value)){acknowledgedDone=endedSession;if(session==endedSession)c.startService(intent(c,"ack-done"));}
    });return;
   }
   if("error".equals(event))js="Studio.audioError('音频播放失败，请重试')";
   if(js!=null)web.evaluateJavascript(js,null);
  }};
  IntentFilter filter=new IntentFilter(context.getPackageName()+".PLAYBACK_STATE");
  if(Build.VERSION.SDK_INT>=33)app.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else app.registerReceiver(receiver,filter);
 }
 static Intent intent(Context c,String cmd){return new Intent(c,PlaybackService.class).putExtra("cmd",cmd).putExtra("session",session);}
 static void command(Context c,String cmd){if(running)c.startService(intent(c,cmd));}
 static void stop(Context c){session++;running=false;playing=false;position=0;c.stopService(new Intent(c,PlaybackService.class));}
}
