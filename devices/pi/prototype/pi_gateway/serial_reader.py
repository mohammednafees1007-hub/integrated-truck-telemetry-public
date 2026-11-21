import asyncio, glob, json
import serial

class Lines:
    def __init__(self,limit=2048): self.buf=bytearray();self.limit=limit;self.discard=False;self.oversized=0
    def feed(self,data):
        out=[]
        for b in data:
            if b==10:
                if not self.discard and self.buf: out.append(bytes(self.buf))
                self.buf.clear();self.discard=False
            elif not self.discard:
                self.buf.append(b)
                if len(self.buf)>self.limit:
                    self.buf.clear();self.discard=True;self.oversized+=1
        return out

def choose_port(config):
    if config['serial_port']!='auto': return config['serial_port']
    ports=glob.glob('/dev/serial/by-id/*')
    if len(ports)==1: return ports[0]
    return None

async def read_serial(state,config):
    while True:
        port=choose_port(config)
        if not port:
            state.connected=False;await asyncio.sleep(2);continue
        try:
            # Nonblocking reads avoid blocking the 20ms publisher.
            with serial.Serial(port,config['baud'],timeout=0,exclusive=True) as dev:
                state.connected=True; lines=Lines();state.metrics['serial_port']=port
                while True:
                    data=dev.read(4096)
                    for line in lines.feed(data):
                        try:
                            frame=json.loads(line)
                            if isinstance(frame,dict) and frame.get('type')=='diagnostic' and frame.get('v')==1:
                                state.metrics['esp_diagnostic']=frame
                            else: state.ingest(frame)
                        except (ValueError,TypeError,KeyError,OverflowError): state.metrics['invalid']+=1
                    state.metrics['oversized']=lines.oversized
                    await asyncio.sleep(.002)
        except (serial.SerialException,OSError) as e:
            state.connected=False;state.metrics['serial_error']=str(e)
            await asyncio.sleep(2)
