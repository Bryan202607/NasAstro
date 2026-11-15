"""API locale FastAPI : comptes/rôles, ingestion capteurs chiffrée, analyse IA locale, et sert l'interface web.
Lancer (depuis backend/) :  uvicorn app.main:app --host 0.0.0.0 --port 8000"""
import hmac, os
from typing import Optional
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from . import db, security, service
from .schemas import EnvIn, LoginIn, RegisterIn, VitalsIn

db.init()
app = FastAPI(title="Jumeau numérique – santé équipage (local)", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

def run(fn, *a, **k):
    try:
        return fn(*a, **k)
    except service.ServiceError as e:
        raise HTTPException(e.status, e.msg)

def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Non authentifié")
    return run(service.user_from_token, authorization[7:])

def sensor_gateway(x_ingest_key: Optional[str] = Header(None)):
    if not x_ingest_key or not hmac.compare_digest(x_ingest_key, security.ingest_key()):
        raise HTTPException(401, "Clé d'ingestion invalide")

@app.on_event("startup")
def banner():
    c = security.access_codes()
    print("\n=== Jumeau numérique (mode normal) ===")
    print("Clé capteurs (header X-Ingest-Key) :", security.ingest_key())
    print("Code création compte MÉDECIN        :", c["doctor"])
    print("Code création compte ADMINISTRATION :", c["admin"], "\n")

@app.get("/api/health")
def health(): return {"status": "ok", "storage": "local (SQLite + AES-256-GCM)"}

@app.post("/api/auth/register")
def register(b: RegisterIn): return run(service.register, b.name, b.age, b.mission, b.role, b.password, b.access_code)

@app.post("/api/auth/login")
def login(b: LoginIn): return run(service.login, b.id, b.password)

@app.get("/api/auth/me")
def me(u=Depends(current_user)): return service.public(u)

@app.get("/api/users")
def users(u=Depends(current_user)): return {"users": run(service.all_users, u)}

@app.get("/api/alerts")
def alerts(u=Depends(current_user)): return {"alerts": service.alerts(u)}

@app.get("/api/audit")
def audit(u=Depends(current_user)): return {"audit": run(service.audit_log, u)}

@app.post("/api/ingest/biometrics", dependencies=[Depends(sensor_gateway)])
def ingest_bio(d: VitalsIn):
    run(service.ingest_vitals, d.model_dump(mode="json")); return {"status": "success"}

@app.post("/api/ingest/environment", dependencies=[Depends(sensor_gateway)])
def ingest_env(d: EnvIn):
    run(service.ingest_env, d.model_dump(mode="json")); return {"status": "success"}

@app.get("/api/astronaut/body-status")
def body_status(astronaut_id: Optional[str] = None, u=Depends(current_user)):
    return run(service.body_status, u, astronaut_id)

FRONT = os.environ.get("ASTRO_FRONT_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "frontend")
if os.path.isdir(FRONT):
    app.mount("/", StaticFiles(directory=FRONT, html=True), name="front")
