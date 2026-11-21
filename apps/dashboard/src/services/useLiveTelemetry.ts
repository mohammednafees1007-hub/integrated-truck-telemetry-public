import {useEffect,useState} from 'react';
import {esp32SensorService} from './esp32SensorService';
import {processPi} from './liveProcessing';
export function useLiveTelemetry() {
  const [state,setState]=useState(()=>esp32SensorService.getState());
  useEffect(()=>esp32SensorService.subscribe(s=>setState({...s})),[]);
  return {...processPi(esp32SensorService.piPacket),state,relay:esp32SensorService.piRelay,ack:esp32SensorService.piAck};
}
