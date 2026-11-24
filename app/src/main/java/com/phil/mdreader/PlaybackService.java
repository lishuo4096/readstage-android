package com.phil.mdreader;
import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.*;
import android.os.*;

public class PlaybackService extends Service {
    static MediaPlayer player; static float rate=1f;
    static Runnable finished, failed, started;
    static java.util.function.IntConsumer advanced;
    private static MediaPlayer nextPlayer;
    private static java.io.File nextFile,currentFile;
    private static int nextSegment;
    static void clearNext(){try{if(player!=null)player.setNextMediaPlayer(null);}catch(Exception ignored){}if(nextPlayer!=null){nextPlayer.release();nextPlayer=null;}if(nextFile!=null){nextFile.delete();nextFile=null;}}
    static void prepareNext(Context context,java.io.File file,int segment)throws Exception{
        if(player==null){file.delete();return;}
        clearNext();MediaPlayer prepared=new MediaPlayer();
        try{prepared.setWakeMode(context,PowerManager.PARTIAL_WAKE_LOCK);prepared.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            prepared.setDataSource(file.getPath());prepared.prepare();installCallbacks(prepared);player.setNextMediaPlayer(prepared);nextPlayer=prepared;nextFile=file;nextSegment=segment;
        }catch(Exception e){prepared.release();file.delete();throw e;}
    }
    private static void installCallbacks(MediaPlayer media){
        media.setOnCompletionListener(p->{
            if(p!=player)return;
            if(nextPlayer!=null){player=nextPlayer;nextPlayer=null;p.release();if(currentFile!=null)currentFile.delete();currentFile=nextFile;nextFile=null;
                updateRate();if(advanced!=null)advanced.accept(nextSegment);
            }else if(finished!=null)finished.run();
        });
        media.setOnErrorListener((p,a,b)->{if(p==player&&failed!=null)failed.run();return true;});
    }
    private int generation=0;
    private boolean completionPending=false;
    private final Handler stateHandler=new Handler(Looper.getMainLooper());
    private final Runnable heartbeat=new Runnable(){public void run(){broadcast(completionPending?"done":"tick",0);stateHandler.postDelayed(this,400);}};
    private void broadcast(String event,int segment){
        int duration=0;try{if(player!=null)duration=player.getDuration();}catch(Exception ignored){}
        Intent i=new Intent(getPackageName()+".PLAYBACK_STATE").setPackage(getPackageName()).putExtra("session",generation).putExtra("event",event).putExtra("segment",segment).putExtra("position",position()).putExtra("duration",duration).putExtra("playing",playing()).putExtra("running",player!=null);sendBroadcast(i);
    }
    private MediaSession session;
    private AudioManager manager;
    private AudioFocusRequest focus;
    static boolean playing(){try{return player!=null&&player.isPlaying();}catch(Exception e){return false;}}
    static int position(){try{return player==null?0:player.getCurrentPosition();}catch(Exception e){return 0;}}
    static void pause(){if(playing())player.pause();}
    static void resume(){if(player!=null){player.start();updateRate();}}
    static void updateRate(){try{if(player!=null){boolean wasPlaying=player.isPlaying();player.setPlaybackParams(player.getPlaybackParams().setSpeed(rate));if(!wasPlaying)player.pause();}}catch(Exception ignored){}}
    @Override public void onCreate(){super.onCreate();
        finished=()->{completionPending=true;broadcast("done",0);};failed=()->broadcast("error",0);started=()->broadcast("started",0);advanced=id->broadcast("advanced",id);stateHandler.post(heartbeat);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("reading","听读播放",NotificationManager.IMPORTANCE_LOW));
        session=new MediaSession(this,"ReadStage");session.setCallback(new MediaSession.Callback(){public void onPause(){pause();}public void onPlay(){resume();}public void onStop(){stopSelf();}});session.setActive(true);
        manager=getSystemService(AudioManager.class);focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setOnAudioFocusChangeListener(change->{if(change<0)pause();}).build();
    }
    @Override public int onStartCommand(Intent i,int flags,int start){
        if(i==null)return START_NOT_STICKY;
        String cmd=i.getStringExtra("cmd");
        if(cmd!=null&&i.getIntExtra("session",-1)!=generation)return START_NOT_STICKY;
        if("ack-done".equals(cmd)){completionPending=false;return START_NOT_STICKY;}
        if(cmd!=null){try{switch(cmd){case "pause":pause();break;case "resume":resume();break;case "rate":rate=i.getFloatExtra("rate",1);updateRate();break;case "queue":prepareNext(this,new java.io.File(i.getStringExtra("path")),i.getIntExtra("segment",0));break;}}catch(Exception ignored){}broadcast("tick",0);if(player==null)stopSelf();return START_NOT_STICKY;}
        completionPending=false;generation=i.getIntExtra("session",0);rate=i.getFloatExtra("rate",1);

        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n=new Notification.Builder(this,"reading").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("墨声 · 正在听读").setContentText(i.getStringExtra("title")).setContentIntent(open).setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken())).build();
        startForeground(1,n); manager.requestAudioFocus(focus);
        try {clearNext();if(player!=null)player.release();if(currentFile!=null&&!currentFile.getPath().equals(i.getStringExtra("path")))currentFile.delete();currentFile=new java.io.File(i.getStringExtra("path"));player=new MediaPlayer();player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(i.getStringExtra("path"));installCallbacks(player);
            player.prepare();player.seekTo(Math.min(i.getIntExtra("offset",0),Math.max(0,player.getDuration()-100)));player.start();updateRate();
            session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_STOP).setState(PlaybackState.STATE_PLAYING,player.getCurrentPosition(),rate).build());
            if(started!=null)started.run();
        }catch(Exception e){if(failed!=null)failed.run();stopSelf();}return START_NOT_STICKY;
    }
    @Override public void onDestroy(){stateHandler.removeCallbacks(heartbeat);clearNext();if(player!=null){player.release();player=null;}if(currentFile!=null){currentFile.delete();currentFile=null;}if(manager!=null)manager.abandonAudioFocusRequest(focus);if(session!=null)session.release();broadcast("stopped",0);super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}
