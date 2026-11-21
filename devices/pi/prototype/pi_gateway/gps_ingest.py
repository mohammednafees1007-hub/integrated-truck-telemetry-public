from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict, Field, field_validator

class GPSFix(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False,strict=True)
    latitude: float=Field(ge=-90,le=90)
    longitude: float=Field(ge=-180,le=180)
    accuracy_m: float=Field(ge=0,le=100000)
    timestamp: str=Field(max_length=64)
    @field_validator('timestamp')
    @classmethod
    def timestamp_valid(cls,v):
        d=datetime.fromisoformat(v.replace('Z','+00:00'))
        if d.tzinfo is None: raise ValueError('timezone required')
        if d.year<2000: raise ValueError('invalid location date')
        return d.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

class GPSLoggerFix(GPSFix):
    @field_validator('timestamp', mode='before')
    @classmethod
    def decode_time(cls, value):
        from urllib.parse import unquote
        return unquote(value) if isinstance(value,str) else value
