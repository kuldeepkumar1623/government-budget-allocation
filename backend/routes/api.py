import io
import json
import logging
from typing import Annotated
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from models.schemas import Filters, filter_params
from services import analysis
from services.dataset_store import ALLOWED_EXTENSIONS, DATA_DIR, read_dataset, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["budget analysis"])
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def get_frame(filters: Filters) -> tuple[pd.DataFrame, dict]:
    try:
        return analysis.filtered_frame(
            filters.dataset_id, filters.year, filters.department, filters.sector, filters.region
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc


@router.get("/files")
def list_files() -> dict:
    return {"files": store.saved_files()}


@router.post("/upload")
async def upload_file(file: Annotated[UploadFile, File()]) -> dict:
    original_name = Path(file.filename or "").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Choose a CSV, XLSX, XLS, or JSON file.")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if not contents:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Files must be 20 MB or smaller.")

    saved_name = store.safe_upload_name(original_name)
    saved_path = DATA_DIR / saved_name
    try:
        saved_path.write_bytes(contents)
        frame = read_dataset(saved_path)
        preview = json.loads(frame.head(10).to_json(orient="records"))
        return {"dataset": store.add(frame, original_name, saved_name), "preview": preview}
    except (ValueError, UnicodeDecodeError, pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        saved_path.unlink(missing_ok=True)
        logger.info("Rejected invalid upload %s: %s", original_name, exc)
        raise HTTPException(status_code=422, detail=f"Could not read this file: {exc}") from exc
    except Exception as exc:
        saved_path.unlink(missing_ok=True)
        logger.exception("Unexpected upload processing error")
        raise HTTPException(status_code=422, detail="The file could not be processed. Check its format and columns.") from exc
    finally:
        await file.close()


@router.post("/load-file")
def load_file(payload: dict) -> dict:
    name = payload.get("name")
    if not isinstance(name, str):
        raise HTTPException(status_code=422, detail="Provide a saved filename in the 'name' field.")
    try:
        return {"dataset": store.load_saved(name)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Could not load saved file %s", name)
        raise HTTPException(status_code=422, detail="The saved file could not be read.") from exc


@router.delete("/files")
def delete_file(name: str = Query(..., min_length=1)) -> dict:
    try:
        return {"deleted": store.delete_saved(name)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Could not delete saved file %s", name)
        raise HTTPException(status_code=422, detail="The saved file could not be deleted.") from exc


@router.get("/summary")
def get_summary(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, metadata = get_frame(filters)
    return analysis.summary(frame, metadata)


@router.get("/options")
def get_options(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, metadata = get_frame(Filters(dataset_id=filters.dataset_id))
    years = frame["Year"].dropna().unique().tolist()
    years.sort(key=lambda value: (not str(value).isdigit(), int(value) if str(value).isdigit() else str(value)))
    return {
        "years": [int(value) if str(value).isdigit() else str(value) for value in years if str(value) != "0"],
        "year_labels": analysis.summary(frame, {}).get("period_labels", {}),
        "default_year": metadata.get("default_year"),
        "departments": sorted(frame["Department"].dropna().astype(str).unique().tolist()),
        "sectors": sorted(frame["Sector"].dropna().astype(str).unique().tolist()),
        "regions": sorted(frame["State/Region"].dropna().astype(str).unique().tolist()),
    }


@router.get("/by-department")
def by_department(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return {"items": analysis.department_breakdown(frame)}


@router.get("/by-sector")
def by_sector(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return {"items": analysis.sector_breakdown(frame)}


@router.get("/by-region")
def by_region(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return {"items": analysis.region_breakdown(frame)}


@router.get("/trends")
def trends(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return {"items": analysis.yearly_trends(frame)}


@router.get("/top-bottom")
def top_bottom(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return analysis.rankings(frame)


@router.get("/anomalies")
def anomalies(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return analysis.anomaly_report(frame)


@router.get("/insights")
def get_insights(filters: Annotated[Filters, Depends(filter_params)]) -> dict:
    frame, _ = get_frame(filters)
    return {"items": analysis.insights(frame)}


@router.get("/table")
def get_table(
    filters: Annotated[Filters, Depends(filter_params)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    sort_by: str = Query(default="Allocated_Amount", max_length=80),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> dict:
    frame, _ = get_frame(filters)
    if search:
        mask = frame.astype(str).apply(
            lambda column: column.str.contains(search, case=False, regex=False)
        ).any(axis=1)
        frame = frame[mask]
    if sort_by not in frame.columns:
        raise HTTPException(status_code=422, detail=f"Unknown sort column: {sort_by}")
    frame = frame.sort_values(sort_by, ascending=sort_order == "asc", kind="stable")
    total = len(frame)
    start = (page - 1) * page_size
    records = frame.iloc[start : start + page_size].astype(object).where(pd.notna(frame.iloc[start : start + page_size]), None)
    return {
        "items": records.to_dict("records"),
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
        "columns": list(frame.columns),
    }


@router.get("/export")
def export_data(
    filters: Annotated[Filters, Depends(filter_params)],
    format: str = Query(default="csv", pattern="^(csv|xlsx)$"),
) -> StreamingResponse:
    frame, metadata = get_frame(filters)
    if format == "xlsx":
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            frame.to_excel(writer, index=False, sheet_name="Budget data")
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{Path(metadata["name"]).stem}_cleaned.xlsx"'},
        )
    text = frame.to_csv(index=False)
    return StreamingResponse(
        io.StringIO(text),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{Path(metadata["name"]).stem}_cleaned.csv"'},
    )