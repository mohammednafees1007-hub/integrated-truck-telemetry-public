package com.prototype.pigps;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;
import android.Manifest;
import java.net.*;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public class GpsService extends Service implements LocationListener {
 public static volatile boolean running=false;
 public static volatile String status="Stopped",details="No location yet",lastAck="None";
 public static volatile long accepted=0;
 static final String CHANNEL="gps-sharing";static final int NOTIFICATION=42;
 LocationManager manager;ScheduledExecutorService sender;PowerManager.WakeLock wake;
 volatile Fix pending;volatile HttpURLConnection connection;
 long newestSourceTime=0;volatile long lastDelivered=0;long lastAcceptedMono=0;
 int failures=0;long nextAttempt=0;long wakeRenewed=0;long lastStatusPoll=0;boolean relayMode=false;String endpoint,token;
 static class Fix {final long time;final String json;Fix(long t,String j){time=t;json=j;}}
 @Override public void onCreate(){super.onCreate();manager=(LocationManager)getSystemService(LOCATION_SERVICE);
  NotificationChannel channel=new NotificationChannel(CHANNEL,"GPS location sharing",NotificationManager.IMPORTANCE_LOW);channel.setDescription("Visible while sending phone locations to your Pi");((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
 }
 Notification notice(){
  PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,GpsService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Pi GPS sharing is active").setContentText(status).setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,"Stop",stop).build()).build();
 }
 void update(String value){status=value;if(running)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION,notice());}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent!=null&&"STOP".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
  if(running)return START_NOT_STICKY;
  try{
   endpoint=Settings.validateEndpoint(Settings.prefs(this).getString("endpoint",""));token=Settings.validateToken(Settings.prefs(this).getString("token",""));
   if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)throw new IllegalStateException("Precise location permission missing");
   if(!manager.isProviderEnabled(LocationManager.GPS_PROVIDER))throw new IllegalStateException("Turn on device location/GPS and press Start again");
   status="Waiting for a fresh GPS fix";
   if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notice(),ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);else startForeground(NOTIFICATION,notice());
   running=true;accepted=0;lastAck="None";details="Waiting for a new GPS fix";
   // Timeout is renewed by the active sender; stop releases it immediately.
   wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"pigps:sharing");wake.setReferenceCounted(false);wake.acquire(10*60*1000L);wakeRenewed=SystemClock.elapsedRealtime();
   manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,1000,0,this,Looper.getMainLooper());
   sender=Executors.newSingleThreadScheduledExecutor();sender.scheduleAtFixedRate(()->sendLatest(),0,1,TimeUnit.SECONDS);
  }catch(Exception e){status="Cannot start: "+e.getMessage();stopSelf();}
  return START_NOT_STICKY;
 }
 @Override public void onLocationChanged(Location location){
  if(!running||!location.hasAccuracy()||location.getTime()<=newestSourceTime)return;
  if((SystemClock.elapsedRealtimeNanos()-location.getElapsedRealtimeNanos())/1e9>10){update("GPS fix is stale — waiting for a new fix");return;}
  double lat=location.getLatitude(),lon=location.getLongitude(),accuracy=location.getAccuracy();
  if(!Double.isFinite(lat)||!Double.isFinite(lon)||!Double.isFinite(accuracy)||lat<-90||lat>90||lon<-180||lon>180||accuracy<0)return;
  try{
   SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));
   JSONObject json=new JSONObject();json.put("latitude",lat);json.put("longitude",lon);json.put("accuracy_m",accuracy);json.put("timestamp",format.format(new Date(location.getTime())));
   newestSourceTime=location.getTime();pending=new Fix(location.getTime(),json.toString());lastAcceptedMono=SystemClock.elapsedRealtime();
   details=String.format(Locale.US,"Latitude: %.6f\nLongitude: %.6f\nAccuracy: %.1f m\nMeasured: %s",lat,lon,accuracy,format.format(new Date(location.getTime())));
  }catch(Exception e){update("Invalid location fix");}
 }
 void sendLatest(){
  if(!running)return;
  if(wake!=null && (!wake.isHeld()||SystemClock.elapsedRealtime()-wakeRenewed>9*60*1000)){wake.acquire(10*60*1000L);wakeRenewed=SystemClock.elapsedRealtime();}
  if(SystemClock.elapsedRealtime()<nextAttempt)return;
  Fix fix=pending;
  if(fix==null){update("Waiting for GPS — use an open outdoor area");return;}
  if(fix.time<=lastDelivered){if(relayMode)pollPiConfirmation();if(SystemClock.elapsedRealtime()-lastAcceptedMono>5000)update("No fresh GPS fix for over 5 seconds");return;}
  if(SystemClock.elapsedRealtime()-lastAcceptedMono>10000){update("Latest fix is stale; waiting for GPS");return;}
  HttpURLConnection conn=null;
  try{
   if(!running)return;
   conn=(HttpURLConnection)new URL(endpoint).openConnection();connection=conn;conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(4000);conn.setReadTimeout(4000);conn.setRequestMethod("POST");conn.setRequestProperty("Authorization","Bearer "+token);conn.setRequestProperty("X-GPS-Key",token);conn.setRequestProperty("Content-Type","application/json");conn.setDoOutput(true);
   byte[] bytes=fix.json.getBytes(java.nio.charset.StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(bytes.length);
   if(!running)return;
   try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
   int code=conn.getResponseCode();
   if(code>=200&&code<300){
    JSONObject response=readJson(conn);lastDelivered=fix.time;accepted++;failures=0;nextAttempt=0;showAcknowledgement(response);
   }else if(code==401||code==403){nextAttempt=SystemClock.elapsedRealtime()+15000;update("Pairing key rejected — stop and check settings");}
   else if(code==409){lastDelivered=fix.time;nextAttempt=SystemClock.elapsedRealtime()+1000;update("Pi rejected fix timing — check automatic phone time");}
   else throw new IOException("HTTP "+code);
  }catch(Exception e){failures=Math.min(5,failures+1);nextAttempt=SystemClock.elapsedRealtime()+Math.min(15000,1000L*(1L<<failures));if(running)update("Not delivered — check internet / endpoint; retrying");}
  finally{connection=null;if(conn!=null)conn.disconnect();}
 }
 JSONObject readJson(HttpURLConnection conn) throws Exception {
  try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] buf=new byte[512];int n,total=0;while((n=in.read(buf))!=-1){total+=n;if(total>4096)throw new IOException("Response too large");out.write(buf,0,n);}
   return new JSONObject(new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));
  }
 }
 void showAcknowledgement(JSONObject response){
  if(response.optBoolean("stored_by_relay",false)){
   relayMode=true;String stamp=response.optString("pi_last_ack_timestamp","");Object age=response.opt("pi_ack_age_s");
   if(!stamp.isEmpty()&&!stamp.equals("null"))lastAck=stamp;
   boolean fresh=age instanceof Number && ((Number)age).doubleValue()<=10;
   update(fresh?"Pi confirmed delivery through website":"Website received fix — waiting for Pi confirmation");
  }else{lastAck=new SimpleDateFormat("HH:mm:ss",Locale.getDefault()).format(new Date());update("Connected — Pi acknowledged location");}
 }
 void pollPiConfirmation(){
  if(SystemClock.elapsedRealtime()-lastStatusPoll<3000)return;lastStatusPoll=SystemClock.elapsedRealtime();HttpURLConnection conn=null;
  try{
   if(!running)return;String url=endpoint.substring(0,endpoint.lastIndexOf('/')+1)+"status.php";
   conn=(HttpURLConnection)new URL(url).openConnection();connection=conn;conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(3000);conn.setReadTimeout(3000);conn.setRequestProperty("X-GPS-Key",token);
   if(conn.getResponseCode()==200)showAcknowledgement(readJson(conn));
  }catch(Exception e){if(running)update("Cannot check Pi confirmation — retrying");}
  finally{connection=null;if(conn!=null)conn.disconnect();}
 }
 @Override public void onProviderDisabled(String provider){update("GPS disabled — enable device location");}
 @Override public void onProviderEnabled(String provider){update("GPS enabled — waiting for a fix");}
 @Override public void onStatusChanged(String p,int status,Bundle extras){}
 @Override public android.os.IBinder onBind(Intent intent){return null;}
 @Override public void onDestroy(){running=false;if(!status.startsWith("Cannot start:"))status="Stopped — location sharing is off";pending=null;if(manager!=null){try{manager.removeUpdates(this);}catch(Exception ignored){}}if(connection!=null)connection.disconnect();if(sender!=null)sender.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}
