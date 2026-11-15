from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

class RegisterIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    age: int = Field(..., ge=18, le=80)
    mission: str = Field("", max_length=80)
    role: Literal["astronaut", "doctor", "admin"] = "astronaut"
    password: str = Field(..., min_length=8, max_length=128)
    access_code: str = ""

class LoginIn(BaseModel):
    id: str
    password: str

class VitalsIn(BaseModel):
    astronaut_id: str
    heart_rate: float = Field(..., gt=20, lt=250)
    spo2: float = Field(..., ge=50, le=100)
    hrv: Optional[float] = Field(None, ge=0, le=300)
    body_temp: float = Field(..., ge=30, le=45)
    skin_temp: Optional[float] = Field(None, ge=20, le=40)
    resp_rate: Optional[float] = Field(None, ge=4, le=60)
    bp_sys: Optional[float] = Field(None, ge=50, le=260)
    bp_dia: Optional[float] = Field(None, ge=30, le=160)
    hydration_pct: Optional[float] = Field(None, ge=0, le=100)
    muscle_load: Optional[float] = Field(None, ge=0, le=1)
    sensor_ts: Optional[datetime] = None

class EnvIn(BaseModel):
    mission: str
    co2_ppm: float = Field(..., ge=0, le=20000)
    cabin_temp: float = Field(..., ge=-20, le=60)
    radiation_mgy_h: float = Field(..., ge=0)
    sensor_ts: Optional[datetime] = None
