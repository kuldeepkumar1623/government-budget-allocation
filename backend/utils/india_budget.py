from pathlib import Path

import numpy as np
import pandas as pd


RUPEES_PER_CRORE = 10_000_000


def is_india_budget_workbook(path: Path) -> bool:
    if path.suffix.lower() != ".xlsx":
        return False
    try:
        with pd.ExcelFile(path) as workbook:
            if not {"Line Items", "Ministry Demand Summary"}.issubset(workbook.sheet_names):
                return False
            columns = set(pd.read_excel(workbook, sheet_name="Line Items", nrows=0).columns)
            return {"row_type", "item_name", "ministry", "demand_name"}.issubset(columns)
    except (ValueError, OSError, ImportError):
        return False


def read_india_budget_workbook(path: Path) -> pd.DataFrame:
    line_items = pd.read_excel(path, sheet_name="Line Items")
    net_demands = line_items[
        line_items["row_type"].astype("string").str.casefold().eq("demand_summary")
        & line_items["item_name"].astype("string").str.casefold().eq("net")
    ].copy()
    if net_demands.empty:
        raise ValueError("The budget workbook contains no net demand summary rows.")

    periods = [
        (2024, "2024-25 Actual Expenditure", "actual_2024_25_total", True, None),
        (2025, "2025-26 Revised Estimate", "re_2025_26_total", False, "re_2025_26_total"),
        (2026, "2026-27 Budget Estimate", "be_2026_27_total", False, None),
    ]
    frames = []
    for year, label, amount_column, is_actual, revised_column in periods:
        if amount_column not in net_demands.columns:
            raise ValueError(f"The budget workbook is missing '{amount_column}'.")
        crore_amount = pd.to_numeric(net_demands[amount_column], errors="coerce")
        reported = crore_amount.notna() & is_actual
        amount = crore_amount.fillna(0) * RUPEES_PER_CRORE
        revised = (
            pd.to_numeric(net_demands[revised_column], errors="coerce").fillna(0)
            * RUPEES_PER_CRORE
            if revised_column
            else np.zeros(len(net_demands))
        )
        frames.append(pd.DataFrame({
            "Year": year,
            "Fiscal_Period": label,
            "Department": net_demands["ministry"].fillna("Unassigned").astype(str).str.strip(),
            "Sector": net_demands["section"].fillna("Unclassified").astype(str).str.strip(),
            "State/Region": "India",
            "Scheme": net_demands["demand_name"].fillna("Unspecified").astype(str).str.strip(),
            "Allocated_Amount": amount,
            "Spent_Amount": amount.where(reported, np.nan),
            "Revised_Estimate": revised,
            "_Spent_Amount_Reported": reported,
        }))

    normalized = pd.concat(frames, ignore_index=True)
    normalized.attrs["default_year"] = 2026
    normalized.attrs["currency_unit"] = "INR"
    normalized.attrs["source_unit"] = "INR crore"
    return normalized