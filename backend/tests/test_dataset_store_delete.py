from pathlib import Path

import pytest

from services.dataset_store import DATA_DIR, DatasetStore


def test_delete_saved_removes_file(tmp_path, monkeypatch):
    monkeypatch.setattr("services.dataset_store.DATA_DIR", tmp_path)
    store = DatasetStore()
    file_path = tmp_path / "sample_delete.csv"
    file_path.write_text("Year,Department,Allocated_Amount\n2024,Finance,100\n", encoding="utf-8")

    deleted = store.delete_saved(file_path.name)

    assert deleted == file_path.name
    assert not file_path.exists()
    assert file_path.name not in [item["name"] for item in store.saved_files()]


def test_delete_saved_rejects_path_traversal():
    store = DatasetStore()
    with pytest.raises(ValueError):
        store.delete_saved("../outside.csv")
