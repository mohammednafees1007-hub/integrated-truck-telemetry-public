package com.prototype.pigps;
import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;

public class MainActivity extends Activity {
 EditText endpoint,key;TextView status,details;Button start,stop,save;
 Handler handler=new Handler();boolean requestStart=false;
 final Runnable refresh=new Runnable(){public void run(){
  status.setText(GpsService.status);
  details.setText(GpsService.details+"\n\nUpload receipts: "+GpsService.accepted+"\nLast confirmed Pi delivery: "+GpsService.lastAck+"\nTarget: 1 new fix/second; actual availability depends on Android and GPS reception.");
  start.setEnabled(!GpsService.running);stop.setEnabled(GpsService.running);save.setEnabled(!GpsService.running);
  endpoint.setEnabled(!GpsService.running);key.setEnabled(!GpsService.running);handler.postDelayed(this,1000);
 }};
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE);
  ScrollView scroll=new ScrollView(this);LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(28,36,28,28);scroll.addView(box);setContentView(scroll);
  if(Build.VERSION.SDK_INT>=30)scroll.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
  TextView title=new TextView(this);title.setText("Pi GPS Sender");title.setTextSize(28);title.setTextColor(Color.rgb(20,40,65));box.addView(title);
  TextView intro=new TextView(this);intro.setText("Share this phone’s location with your Raspberry Pi over the internet. Sharing starts only when you press Start.");intro.setPadding(0,20,0,24);box.addView(intro);
  endpoint=new EditText(this);endpoint.setHint("HTTPS GPS endpoint");endpoint.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);endpoint.setSingleLine(true);box.addView(endpoint);
  key=new EditText(this);key.setHint("Pairing key");key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setSingleLine(true);box.addView(key);
  save=new Button(this);save.setText("Save connection");box.addView(save);save.setOnClickListener(v->saveConnection());
  start=new Button(this);start.setText("Start sharing location");box.addView(start);start.setOnClickListener(v->begin());
  stop=new Button(this);stop.setText("Stop sharing");box.addView(stop);stop.setOnClickListener(v->{stopService(new Intent(this,GpsService.class));GpsService.status="Stopped";});
  Button permissions=new Button(this);permissions.setText("Open app permissions / battery settings");box.addView(permissions);permissions.setOnClickListener(v->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));
  status=new TextView(this);status.setTextSize(20);status.setPadding(0,24,0,16);box.addView(status);details=new TextView(this);details.setTextIsSelectable(true);box.addView(details);
  endpoint.setText(com.prototype.pigps.Settings.prefs(this).getString("endpoint","https://navionrobotics.com/pi-gps/ingest.php"));key.setText(com.prototype.pigps.Settings.prefs(this).getString("token",""));applyPairing(getIntent());
 }
 boolean saveConnection(){try{
  String url=com.prototype.pigps.Settings.validateEndpoint(endpoint.getText().toString());String token=com.prototype.pigps.Settings.validateToken(key.getText().toString().trim());
  com.prototype.pigps.Settings.prefs(this).edit().putString("endpoint",url).putString("token",token).apply();Toast.makeText(this,"Connection saved",Toast.LENGTH_SHORT).show();return true;
 }catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();return false;}}
 void applyPairing(Intent i){if(GpsService.running)return;Uri u=i.getData();if(u==null)return;
  try{if(!"pigps".equals(u.getScheme())||!"pair".equals(u.getHost()))return;endpoint.setText(com.prototype.pigps.Settings.validateEndpoint(u.getQueryParameter("endpoint")));key.setText(com.prototype.pigps.Settings.validateToken(u.getQueryParameter("token")));Toast.makeText(this,"Pairing filled in. Save, then press Start.",Toast.LENGTH_LONG).show();}catch(Exception e){Toast.makeText(this,"Invalid pairing link",Toast.LENGTH_LONG).show();}}
 @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);applyPairing(i);}
 void begin(){if(!saveConnection())return;
  if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestStart=true;requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},7);return;}
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestStart=true;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},8);return;}
  startForegroundService(new Intent(this,GpsService.class));
 }
 @Override public void onRequestPermissionsResult(int code,String[] p,int[] r){super.onRequestPermissionsResult(code,p,r);if(!requestStart)return;requestStart=false;
  if(code==7){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)begin();else Toast.makeText(this,"Choose Precise location to send useful GPS fixes",Toast.LENGTH_LONG).show();}
  else if(code==8)startForegroundService(new Intent(this,GpsService.class));
 }
 @Override protected void onResume(){super.onResume();handler.post(refresh);}
 @Override protected void onPause(){handler.removeCallbacks(refresh);super.onPause();}
}
