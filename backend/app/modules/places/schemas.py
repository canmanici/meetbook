"""Pydantic schemas for the places proxy module."""

from pydantic import BaseModel


class PlaceSuggestion(BaseModel):
    place_id: str
    description: str


class PlaceSummary(BaseModel):
    """A place result — never includes either participant's true location."""

    place_id: str | None
    name: str
    address: str | None
    category: str | None
    lat: float
    lng: float


class AutocompleteResponse(BaseModel):
    items: list[PlaceSuggestion]


class NearbyResponse(BaseModel):
    items: list[PlaceSummary]
