#pragma once
// Proposed classic ESP32 pins. User will wire sensors after flashing.
#define IMU_SDA 21
#define IMU_SCL 22
#define RFID_SCK 18
#define RFID_MISO 19
#define RFID_MOSI 23
#define RFID_SS 27
#define RFID_RST 26
#define WATER_RX 33
#define WATER_TX 25
// Keep 0 until actual SR04M-2 mode/levels verified. 1 = verified FF/high/low/checksum UART.
#define WATER_UART_VERIFIED 0
// Verified TRIG=GPIO25 and divided ECHO=GPIO33. 10 Hz, nonblocking capture.
#define WATER_PULSE_VERIFIED 1
#define WATER_BAUD 9600
