package com.prototype.pigps;
import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
public final class Settings {
 public static SharedPreferences prefs(Context c){return c.getSharedPreferences("connection",Context.MODE_PRIVATE);}
 public static String validateEndpoint(String value){
  URI u=URI.create(value.trim());
  if(!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||u.getFragment()!=null||u.getQuery()!=null)throw new IllegalArgumentException("Use an HTTPS endpoint without query, fragment or username");
  if(u.getPath()==null||u.getPath().isEmpty()||u.getPath().equals("/"))throw new IllegalArgumentException("Enter the complete GPS receiver URL");
  return u.toASCIIString();
 }
 public static String validateToken(String token){
  if(!token.matches("[A-Za-z0-9_-]{32,128}"))throw new IllegalArgumentException("Paste the complete pairing key");return token;
 }
}
