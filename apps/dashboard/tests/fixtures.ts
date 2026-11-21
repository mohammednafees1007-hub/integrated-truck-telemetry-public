export function packet(now=Date.now()):any {
  const stamp=new Date(now).toISOString();
  return {schema_version:1,bridge_sent_at:stamp,bridge_boot_id:'bridge-boot-001',bridge_seq:1,sensors:{schema_version:1,device_id:'pi-test',vehicle_id:'test',boot_id:'gateway-boot',seq:1,timestamp:stamp,
    imu:{lin_accel_x:1,lin_accel_y:2,lin_accel_z:3,gyro_x:1,gyro_y:0,gyro_z:0,quaternion:{w:1,x:0,y:0,z:0},status:'ok',received_at:stamp},
    ultrasonic:{distance_mm:null,echo_us:1000,status:'ok',received_at:stamp},rfid:{card_id:'A1B2C3D4',status:'ok',last_scan_timestamp:stamp},gps:{latitude:12,longitude:77,accuracy_m:4,timestamp:stamp,received_at:stamp,status:'ok'},source:{esp_seq:5}},camera:{schema_version:1,status:'no_face',face_detected:false,results:null}};
}
