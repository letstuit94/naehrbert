from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import analysis, feedback, profile, profiles, receipts, recipes
from backend.app.core.config import get_settings

app = FastAPI(title="naehrbert", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profile.router)
app.include_router(profiles.router)
app.include_router(receipts.router)
app.include_router(analysis.router)
app.include_router(recipes.router)
app.include_router(feedback.router)


@app.get("/health")
def health():
    return {"status": "ok"}
