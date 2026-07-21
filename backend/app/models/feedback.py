"""
User feedback schema — the one-time NPS question asked at the start of the
recipe-preferences chat ("how likely are you to recommend this app...").
"""

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    nps_score: int = Field(ge=1, le=10)
