#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_BNO08x.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "pins.h"
Adafruit_BNO08x bno(-1);
MFRC522 rfid(RFID_SS, RFID_RST);
sh2_SensorValue_t ev;
float av[3],gv[3],qv[4];
bool have[3]={false,false,false}, bad[3]={false,false,false}, imuReady=false, readerReady=false;
uint64_t imuStarted=0;
uint8_t probeA=255,probeB=255,rfidVersion=0;
bool imuInitAttempted=false,imuInitOK=false;
uint32_t lastDiagnostic=0;
uint64_t rn[3]={0,0,0},rt[3]={0,0,0},seq=0,wn=0,wt=0,re=0,rrt=0;
uint8_t rs[3]={0,0,0};
char bootId[24], uid[21]="", lastUid[21]="";
uint32_t lastScan=0,lastAttempt=0,lastReader=0; bool readerChecked=false;
uint64_t nextPacket=0; int waterMm=0; const char* waterState="unconfigured";
HardwareSerial water(2);
#if WATER_UART_VERIFIED && WATER_PULSE_VERIFIED
#error Select only one ultrasonic mode
#endif
#if WATER_PULSE_VERIFIED
portMUX_TYPE waterMux=portMUX_INITIALIZER_UNLOCKED;
volatile bool waterArmed=false,waterPending=false;
volatile uint64_t waterRise=0;
volatile uint32_t waterWidth=0;
uint64_t waterTrigger=0;
uint32_t waterEchoUs=0;
void ARDUINO_ISR_ATTR waterEdge(){
 uint64_t now=esp_timer_get_time();bool high=digitalRead(WATER_RX);
 portENTER_CRITICAL_ISR(&waterMux);
 if(waterArmed){
  if(high)waterRise=now;
  else if(waterRise){waterWidth=(uint32_t)(now-waterRise);waterPending=true;waterArmed=false;}
 }
 portEXIT_CRITICAL_ISR(&waterMux);
}
#endif

struct RfidSnapshot { char uid[21];uint64_t event,t_us;bool ready;uint8_t version; };
QueueHandle_t rfidQueue;
void rfidWorker(void*);
void imuCallback(void*,sh2_SensorEvent_t*);

void reports(){
 bool a=bno.enableReport(SH2_LINEAR_ACCELERATION,20000);
 bool g=bno.enableReport(SH2_GYROSCOPE_CALIBRATED,20000);
 bool q=bno.enableReport(SH2_ROTATION_VECTOR,20000);
 imuReady=a&&g&&q;imuStarted=esp_timer_get_time();
}
void setup(){
 Serial.setTxBufferSize(4096);
 Serial.begin(460800);
 snprintf(bootId,sizeof(bootId),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
 Wire.begin(IMU_SDA,IMU_SCL);Wire.setClock(400000);Wire.setTimeOut(5);
 SPI.begin(RFID_SCK,RFID_MISO,RFID_MOSI,RFID_SS);rfid.PCD_Init();
#if WATER_UART_VERIFIED
 water.begin(WATER_BAUD,SERIAL_8N1,WATER_RX,WATER_TX);waterState="waiting";
#endif
#if WATER_PULSE_VERIFIED
 pinMode(WATER_TX,OUTPUT);digitalWrite(WATER_TX,LOW);pinMode(WATER_RX,INPUT);
 attachInterrupt(digitalPinToInterrupt(WATER_RX),waterEdge,CHANGE);waterState="waiting";
#endif
 rfidQueue=xQueueCreate(1,sizeof(RfidSnapshot));
 xTaskCreatePinnedToCore(rfidWorker,"rfid",4096,nullptr,1,nullptr,0);
 nextPacket=esp_timer_get_time()+20000;
}
void readImu(uint64_t now){
 // Avoid noisy driver diagnostics by probing address before initializing.
 if(!imuReady && millis()-lastAttempt>2000){
  lastAttempt=millis();Wire.beginTransmission(0x4A);probeA=Wire.endTransmission();bool a=probeA==0;
  Wire.beginTransmission(0x4B);probeB=Wire.endTransmission();bool b=probeB==0;
  if(a||b){imuInitAttempted=true;imuInitOK=bno.begin_I2C(a?0x4A:0x4B);imuReady=imuInitOK;if(imuReady){sh2_setSensorCallback(imuCallback,nullptr);reports();}}
 }
 if(!imuReady)return;
 if(bno.wasReset()){for(int j=0;j<3;j++)have[j]=false;reports();}
 uint64_t stop=esp_timer_get_time()+3000;
 for(int k=0;k<8 && esp_timer_get_time()<stop;k++){
  uint64_t before=rn[0]+rn[1]+rn[2];sh2_service();
  if(before==rn[0]+rn[1]+rn[2])break;
 }
 if(now>(have[0]?rt[0]:imuStarted)+2000000)imuReady=false;
}
void imuCallback(void*,sh2_SensorEvent_t* event){
 sh2_SensorValue_t ev;
 if(sh2_decodeSensorEvent(&ev,event)!=SH2_OK)return;
  int j=-1;
  if(ev.sensorId==SH2_LINEAR_ACCELERATION){j=0;av[0]=ev.un.linearAcceleration.x;av[1]=ev.un.linearAcceleration.y;av[2]=ev.un.linearAcceleration.z;}
  else if(ev.sensorId==SH2_GYROSCOPE_CALIBRATED){j=1;gv[0]=ev.un.gyroscope.x;gv[1]=ev.un.gyroscope.y;gv[2]=ev.un.gyroscope.z;}
  else if(ev.sensorId==SH2_ROTATION_VECTOR){j=2;qv[0]=ev.un.rotationVector.real;qv[1]=ev.un.rotationVector.i;qv[2]=ev.un.rotationVector.j;qv[3]=ev.un.rotationVector.k;}
  // Host-read MCU monotonic timestamps; sensor frame/axis verification pending.
  if(j>=0){
   float* v=j==0?av:j==1?gv:qv;bool valid=true;
   for(int k=0;k<(j==2?4:3);k++)valid=valid&&isfinite(v[k]);
   if(j==2){float norm=0;for(int k=0;k<4;k++)norm+=v[k]*v[k];valid=valid&&norm>=0.64f&&norm<=1.44f;}
   bad[j]=!valid;have[j]=valid;
   if(valid){rn[j]++;rt[j]=esp_timer_get_time();rs[j]=ev.status;}
  }
}
void readRfid(){
 if(!readerChecked||millis()-lastReader>1000){
  lastReader=millis();readerChecked=true;byte v=rfid.PCD_ReadRegister(MFRC522::VersionReg);rfidVersion=v;
  bool found=v==0x91||v==0x92||v==0x88;
  if(found && !readerReady)rfid.PCD_Init();
  readerReady=found;
 }
 if(!readerReady)return;
 // Wake halted cards to distinguish a held card from removal/re-presentation.
 byte atqa[2];byte len=2;
 auto result=rfid.PICC_WakeupA(atqa,&len);
 if(result!=MFRC522::STATUS_OK && result!=MFRC522::STATUS_COLLISION){
  if(millis()-lastScan>600)lastUid[0]=0;
  return;
 }
 if(!rfid.PICC_ReadCardSerial())return;
 char current[21];int n=0;
 for(byte j=0;j<rfid.uid.size && j<10;j++)n+=snprintf(current+n,sizeof(current)-n,"%02X",rfid.uid.uidByte[j]);
 if(strcmp(current,lastUid)!=0){strcpy(uid,current);strcpy(lastUid,current);re++;rrt=esp_timer_get_time();}
 lastScan=millis();rfid.PICC_HaltA();rfid.PCD_StopCrypto1();
}
void rfidWorker(void*){
 while(true){
  readRfid();
  RfidSnapshot snapshot={};strcpy(snapshot.uid,uid);snapshot.event=re;snapshot.t_us=rrt;snapshot.ready=readerReady;snapshot.version=rfidVersion;
  xQueueOverwrite(rfidQueue,&snapshot);
  vTaskDelay(pdMS_TO_TICKS(50));
 }
}
void readWater(){
#if WATER_PULSE_VERIFIED
 uint64_t now=esp_timer_get_time();bool complete=false;uint32_t width=0;
 portENTER_CRITICAL(&waterMux);
 if(waterPending){complete=true;width=waterWidth;waterPending=false;}
 portEXIT_CRITICAL(&waterMux);
 if(complete){
  if(width>=100 && width<=40000){waterEchoUs=width;wn++;wt=now;waterState="ok";}
  else waterState="invalid";
 }
 if(waterTrigger && now-waterTrigger>40000){
  portENTER_CRITICAL(&waterMux);bool timedOut=waterArmed;waterArmed=false;portEXIT_CRITICAL(&waterMux);
  if(timedOut)waterState="invalid";
 }
 if(!waterTrigger || now-waterTrigger>=100000){
  portENTER_CRITICAL(&waterMux);waterRise=0;waterPending=false;waterArmed=true;portEXIT_CRITICAL(&waterMux);
  waterTrigger=now;digitalWrite(WATER_TX,HIGH);delayMicroseconds(20);digitalWrite(WATER_TX,LOW);
 }
#endif
#if WATER_UART_VERIFIED
 static byte buf[4];static int pos=0;static uint32_t lastByte=0;
 int budget=64;
 while(water.available() && budget--){
  byte b=water.read();if(millis()-lastByte>20)pos=0;lastByte=millis();
  if(pos==0 && b!=0xFF)continue;
  buf[pos++]=b;
  if(pos==4){
   pos=0;
   if((byte)(buf[0]+buf[1]+buf[2])==buf[3]){
    int d=((int)buf[1]<<8)|buf[2];
    if(d>0){waterMm=d;wn++;wt=esp_timer_get_time();waterState="ok";}else waterState="invalid";
   }else waterState="invalid";
  }
 }
#endif
}
void emit(uint64_t now){
 RfidSnapshot snapshot={};xQueuePeek(rfidQueue,&snapshot,0);now=esp_timer_get_time();
 JsonDocument d;d["v"]=1;d["boot"]=bootId;d["seq"]=seq++;d["t_us"]=now;
 auto i=d["imu"].to<JsonObject>();
 const char* keys[]={"a","g","q"};float* vals[]={av,gv,qv};
 for(int j=0;j<3;j++){
  if(have[j]){auto a=i[keys[j]].to<JsonArray>();for(int k=0;k<(j==2?4:3);k++)a.add(vals[j][k]);}
  else i[keys[j]]=nullptr;
 }
 auto n=i["n"].to<JsonArray>();auto t=i["us"].to<JsonArray>();auto s=i["s"].to<JsonArray>();
 for(int j=0;j<3;j++){if(have[j]){n.add(rn[j]);t.add(rt[j]);s.add(rs[j]);}else{n.add(nullptr);t.add(nullptr);s.add(nullptr);}}
 i["state"]=(bad[0]||bad[1]||bad[2])?"invalid":!imuReady?"disconnected":(!have[0]||!have[1]||!have[2])?"waiting":"ok";
 auto u=d["us"].to<JsonObject>();u["mm"]=nullptr;u["echo_us"]=nullptr;u["n"]=nullptr;u["t_us"]=nullptr;
 if(wn && strcmp(waterState,"ok")==0){
#if WATER_PULSE_VERIFIED
  u["echo_us"]=waterEchoUs;
#else
  u["mm"]=waterMm;
#endif
  u["n"]=wn;u["t_us"]=wt;
 }
 u["state"]=waterState;
 auto r=d["rfid"].to<JsonObject>();r["uid"]=nullptr;r["event"]=nullptr;r["t_us"]=nullptr;
 if(snapshot.event){r["uid"]=snapshot.uid;r["event"]=snapshot.event;r["t_us"]=snapshot.t_us;}
 r["state"]=snapshot.ready?"ok":"disconnected";
 char line[2048];size_t size=measureJson(d);
 if(!d.overflowed() && size+1<sizeof(line)){
  serializeJson(d,line,sizeof(line));Serial.write((uint8_t*)line,size);Serial.write('\n');Serial.flush();
 }
}
void emitDiagnostic(){
 JsonDocument d;d["type"]="diagnostic";d["v"]=1;
 d["i2c_4a_error"]=probeA;d["i2c_4b_error"]=probeB;
 d["ultrasonic_mode"]=WATER_PULSE_VERIFIED?"trigger_echo":WATER_UART_VERIFIED?"uart":"disabled";
 d["ultrasonic_valid_samples"]=wn;
 d["sda_level"]=digitalRead(IMU_SDA);d["scl_level"]=digitalRead(IMU_SCL);
 d["imu_init_attempted"]=imuInitAttempted;d["imu_init_ok"]=imuInitOK;d["imu_reports_enabled"]=imuReady;
 RfidSnapshot snapshot={};xQueuePeek(rfidQueue,&snapshot,0);d["rfid_version"]=snapshot.version;
 serializeJson(d,Serial);Serial.write('\n');Serial.flush();
}
void loop(){
 uint64_t now=esp_timer_get_time();readImu(now);readWater();
 now=esp_timer_get_time();if(now>=nextPacket){emit(now);nextPacket+=20000;if(now>=nextPacket+20000)nextPacket=now+20000;}
 if(millis()-lastDiagnostic>=2000){lastDiagnostic=millis();emitDiagnostic();}
 delay(1);
}
