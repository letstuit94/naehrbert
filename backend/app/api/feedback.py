"""User feedback (NPS) -- the recipe-preferences chat's one-time "how
likely are you to recommend this app" question."""

from fastapi import APIRouter, Depends

from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.feedback import FeedbackCreate

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("")
def create_feedback(payload: FeedbackCreate, profile_id: int = Depends(require_profile_id)):
    return repo.insert_feedback(profile_id, payload.nps_score)
