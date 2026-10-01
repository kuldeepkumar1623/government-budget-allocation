from dataclasses import dataclass

from fastapi import Query


@dataclass
class Filters:
    dataset_id: str | None = None
    year: str | None = None
    department: str | None = None
    sector: str | None = None
    region: str | None = None


def filter_params(
    dataset_id: str | None = Query(default=None),
    year: str | None = Query(default=None),
    department: str | None = Query(default=None),
    sector: str | None = Query(default=None),
    region: str | None = Query(default=None),
) -> Filters:
    return Filters(dataset_id, year, department, sector, region)