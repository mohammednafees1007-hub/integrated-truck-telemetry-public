#include <Arduino.h>
HardwareSerial sensor(2);
uint32_t startMs,lastPrint=0,lastTrigger=0;int phase=-1,pos=0;byte buf[4];uint32_t bytesSeen=0,valid=0,bad=0;
void setup(){Serial.begin(460800);pinMode(25,OUTPUT);digitalWrite(25,LOW);pinMode(33,INPUT);startMs=millis();}
void loop(){
 uint32_t elapsed=millis()-startMs;
 int next=elapsed<15000?0:elapsed<35000?1:2;
 if(next!=phase){
  if(phase==0)sensor.end();phase=next;
  if(phase==0)sensor.begin(9600,SERIAL_8N1,33,-1);
  else pinMode(33,INPUT);
  Serial.printf("PHASE %d\n",phase);
 }
 if(phase==0){
  while(sensor.available()){
   byte b=sensor.read();bytesSeen++;if(pos==0&&b!=0xFF)continue;buf[pos++]=b;
   if(pos==4){pos=0;if((byte)(buf[0]+buf[1]+buf[2])==buf[3]){valid++;Serial.printf("UART_MM %u\n",((unsigned)buf[1]<<8)|buf[2]);}else bad++;}
  }
  if(millis()-lastPrint>1000){lastPrint=millis();Serial.printf("UART bytes=%u valid=%u bad=%u level=%d\n",bytesSeen,valid,bad,digitalRead(33));}
 }else if(phase==1&&millis()-lastTrigger>150){
  lastTrigger=millis();digitalWrite(25,LOW);delayMicroseconds(5);digitalWrite(25,HIGH);delayMicroseconds(20);digitalWrite(25,LOW);
  unsigned long us=pulseIn(33,HIGH,40000);Serial.printf("ECHO_US %lu\n",us);
 }else if(phase==2){if(millis()-lastPrint>1000){lastPrint=millis();Serial.println("DONE");}}
 delay(1);
}
