"""User feedback (NPS) -- the recipe-preferences chat's one-time "how
likely are you to recommend this app" question."""

from fastapi import APIRouter

from backend.app.db import repo
from backend.app.models.feedback import FeedbackCreate

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("")
def create_feedback(payload: FeedbackCreate):
    return repo.insert_feedback(payload.nps_score)
