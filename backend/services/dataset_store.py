import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

import pandas as pd

from utils.cleaning import clean_dataframe
from utils.india_budget import is_india_budget_workbook, read_india_budget_workbook

logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json"}


def read_dataset(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        frame = pd.read_csv(path, encoding="utf-8-sig")
    elif suffix in {".xlsx", ".xls"}:
        frame = (
            read_india_budget_workbook(path)
            if is_india_budget_workbook(path)
            else pd.read_excel(path)
        )
    elif suffix == ".json":
        frame = pd.read_json(path)
    else:
        raise ValueError("Supported file types are CSV, XLSX, XLS, and JSON.")
    attributes = frame.attrs.copy()
    cleaned = clean_dataframe(frame)
    cleaned.attrs.update(attributes)
    return cleaned


class DatasetStore:
    def __init__(self) -> None:
        self._datasets: dict[str, dict] = {}
        self._active_id: str | None = None
        self._lock = RLock()
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    def add(self, frame: pd.DataFrame, name: str, source_name: str | None = None) -> dict:
        dataset_id = str(uuid.uuid4())
        metadata = {
            "dataset_id": dataset_id,
            "name": name,
            "source_name": source_name or name,
            "rows": int(len(frame)),
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        if frame.attrs.get("default_year") is not None:
            metadata["default_year"] = frame.attrs["default_year"]
        if frame.attrs.get("source_unit"):
            metadata["source_unit"] = frame.attrs["source_unit"]
        with self._lock:
            self._datasets[dataset_id] = {"metadata": metadata, "frame": frame.copy()}
            self._active_id = dataset_id
        logger.info("Loaded dataset %s (%s rows)", name, len(frame))
        return metadata.copy()

    def get(self, dataset_id: str | None = None) -> tuple[pd.DataFrame, dict]:
        with self._lock:
            chosen_id = dataset_id or self._active_id
            if chosen_id is None or chosen_id not in self._datasets:
                raise KeyError("Dataset not found. Upload a file or load one from saved files.")
            record = self._datasets[chosen_id]
            return record["frame"].copy(), record["metadata"].copy()

    def ensure_demo_dataset(self) -> None:
        with self._lock:
            if self._active_id is not None:
                return
        saved = [item for item in self.saved_files() if item["name"] != "sample_budget.csv"]
        for item in saved:
            try:
                self.load_saved(item["name"])
                return
            except Exception:
                logger.exception("Could not load saved dataset %s", item["name"])

        demo = DATA_DIR / "sample_budget.csv"
        if demo.exists():
            try:
                self.add(read_dataset(demo), demo.name, demo.name)
            except Exception:
                logger.exception("Could not load the bundled sample dataset")

    def saved_files(self) -> list[dict]:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        files = []
        for path in DATA_DIR.iterdir():
            if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS:
                stat = path.stat()
                files.append({
                    "name": path.name,
                    "size": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                })
        return sorted(files, key=lambda item: item["modified_at"], reverse=True)

    def load_saved(self, name: str) -> dict:
        if not name or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Choose a valid filename from the saved files list.")
        path = (DATA_DIR / name).resolve()
        if path.parent != DATA_DIR.resolve() or not path.is_file():
            raise FileNotFoundError("That saved file does not exist.")
        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            raise ValueError("Supported file types are CSV, XLSX, XLS, and JSON.")
        return self.add(read_dataset(path), path.name, path.name)

    def delete_saved(self, name: str) -> str:
        if not name or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Choose a valid filename from the saved files list.")
        path = (DATA_DIR / name).resolve()
        if path.parent != DATA_DIR.resolve() or not path.is_file():
            raise FileNotFoundError("That saved file does not exist.")
        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            raise ValueError("Supported file types are CSV, XLSX, XLS, and JSON.")
        path.unlink()
        logger.info("Deleted saved dataset %s", name)
        return name

    @staticmethod
    def safe_upload_name(original_name: str) -> str:
        basename = Path(original_name or "upload.csv").name
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", basename).strip("._") or "upload.csv"
        return f"{uuid.uuid4().hex[:10]}_{safe}"


store = DatasetStore()