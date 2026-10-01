import re
from difflib import get_close_matches
from typing import Any

import pandas as pd

CANONICAL_ALIASES = {
    "Year": ["year", "financial year", "fiscal year", "fy", "budget year"],
    "Department": ["department", "ministry", "dept", "administrative department"],
    "Sector": ["sector", "category", "budget sector", "area"],
    "State/Region": ["state region", "state", "region", "province", "location"],
    "Scheme": ["scheme", "program", "programme", "initiative", "project"],
    "Allocated_Amount": [
        "allocated amount", "allocation", "allocated", "budget", "budget amount",
        "approved budget", "original budget", "allocation amount",
    ],
    "Spent_Amount": [
        "spent amount", "spent", "expenditure", "actual expenditure", "actuals",
        "utilized amount", "utilised amount", "amount spent",
    ],
    "Revised_Estimate": [
        "revised estimate", "revised budget", "revised allocation", "revised estimate amount",
    ],
}

REQUIRED_DEFAULTS: dict[str, Any] = {
    "Year": 0,
    "Department": "Unassigned",
    "Sector": "Unclassified",
    "State/Region": "Unspecified",
    "Scheme": "Unspecified",
    "Allocated_Amount": 0.0,
    "Spent_Amount": 0.0,
    "Revised_Estimate": 0.0,
}


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _numeric(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.replace(r"[₹$€£,\s]", "", regex=True)
    cleaned = cleaned.str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    return pd.to_numeric(cleaned, errors="coerce")


def clean_dataframe(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or len(frame.columns) == 0:
        raise ValueError("The uploaded file has no rows or columns to analyze.")

    cleaned = frame.copy()
    cleaned.columns = [str(column).strip() for column in cleaned.columns]
    cleaned = cleaned.loc[:, ~cleaned.columns.str.match(r"^Unnamed:\s*\d+$", case=False)]
    cleaned = cleaned.drop_duplicates().reset_index(drop=True)

    normalized_aliases = {
        canonical: {_key(alias) for alias in [canonical, *aliases]}
        for canonical, aliases in CANONICAL_ALIASES.items()
    }
    rename: dict[str, str] = {}
    used: set[str] = set()
    keys = {_key(str(column)): str(column) for column in cleaned.columns}

    for canonical, aliases in normalized_aliases.items():
        match = next((keys[alias] for alias in aliases if alias in keys), None)
        if match is None:
            candidates = get_close_matches(
                next(iter(aliases)), list(keys), n=1, cutoff=0.88
            )
            if candidates:
                match = keys[candidates[0]]
        if match is not None and match not in used:
            rename[match] = canonical
            used.add(match)

    cleaned = cleaned.rename(columns=rename)
    if "_Spent_Amount_Reported" not in cleaned.columns:
        if "Spent_Amount" in cleaned.columns:
            cleaned["_Spent_Amount_Reported"] = cleaned["Spent_Amount"].notna()
        else:
            cleaned["_Spent_Amount_Reported"] = False
    for column, default in REQUIRED_DEFAULTS.items():
        if column not in cleaned.columns:
            cleaned[column] = default

    cleaned["Allocated_Amount"] = _numeric(cleaned["Allocated_Amount"]).fillna(0).clip(lower=0)
    cleaned["Revised_Estimate"] = _numeric(cleaned["Revised_Estimate"]).fillna(0).clip(lower=0)
    cleaned["_Spent_Amount_Reported"] = cleaned["_Spent_Amount_Reported"].fillna(False).astype(bool)
    cleaned["Spent_Amount"] = _numeric(cleaned["Spent_Amount"]).clip(lower=0)
    cleaned.loc[~cleaned["_Spent_Amount_Reported"], "Spent_Amount"] = pd.NA

    numeric_years = _numeric(cleaned["Year"])
    if numeric_years.notna().all():
        cleaned["Year"] = numeric_years.astype(int)
    else:
        cleaned["Year"] = cleaned["Year"].astype("string").str.strip().fillna("Unknown")

    for column in ("Department", "Sector", "State/Region", "Scheme"):
        default = REQUIRED_DEFAULTS[column]
        cleaned[column] = (
            cleaned[column].astype("string").str.strip().replace("", pd.NA).fillna(default)
        )

    return cleaned.reset_index(drop=True)