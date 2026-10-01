import pandas as pd

from services.dataset_store import store


def filtered_frame(
    dataset_id: str | None,
    year: str | None = None,
    department: str | None = None,
    sector: str | None = None,
    region: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    frame, metadata = store.get(dataset_id)
    if year:
        frame = frame[frame["Year"].astype(str) == str(year)]
    for column, value in (("Department", department), ("Sector", sector), ("State/Region", region)):
        if value:
            frame = frame[frame[column].astype(str).str.casefold() == value.casefold()]
    return frame.copy(), metadata


def summary(frame: pd.DataFrame, metadata: dict) -> dict:
    allocated = float(frame["Allocated_Amount"].sum())
    reported = (
        frame["_Spent_Amount_Reported"].fillna(False).astype(bool)
        if "_Spent_Amount_Reported" in frame.columns
        else frame["Spent_Amount"].notna()
    )
    spending_available = bool(len(frame)) and bool(reported.all())
    spent_values = frame.loc[reported, "Spent_Amount"]
    spent = float(spent_values.sum()) if reported.any() else None
    years = sorted(
        (year for year in frame["Year"].dropna().unique() if str(year) not in {"0", ""}),
        key=lambda year: (not str(year).isdigit(), int(year) if str(year).isdigit() else str(year)),
    )
    year_values = [int(year) if str(year).isdigit() else str(year) for year in years]
    period_labels = {}
    if "Fiscal_Period" in frame.columns:
        period_labels = (
            frame.drop_duplicates("Year").set_index("Year")["Fiscal_Period"].astype(str).to_dict()
        )
    return {
        **metadata,
        "total_budget": allocated,
        "total_spent": spent,
        "utilization_pct": round(spent / allocated * 100, 2) if spending_available and allocated else None,
        "spending_available": spending_available,
        "spending_reported_rows": int(reported.sum()),
        "department_count": int(frame["Department"].nunique()),
        "year_range": [year_values[0], year_values[-1]] if year_values else [],
        "period_labels": {str(year): label for year, label in period_labels.items()},
        "row_count": int(len(frame)),
        "currency": "INR",
    }


def department_breakdown(frame: pd.DataFrame) -> list[dict]:
    grouped = frame.groupby("Department", as_index=False)[["Allocated_Amount", "Spent_Amount"]].sum(min_count=1)
    return grouped.sort_values("Allocated_Amount", ascending=False).to_dict("records")


def sector_breakdown(frame: pd.DataFrame) -> list[dict]:
    grouped = frame.groupby("Sector", as_index=False)["Allocated_Amount"].sum()
    total = float(grouped["Allocated_Amount"].sum())
    grouped["share_pct"] = (grouped["Allocated_Amount"] / total * 100).round(2) if total else 0
    return grouped.sort_values("Allocated_Amount", ascending=False).to_dict("records")


def region_breakdown(frame: pd.DataFrame) -> list[dict]:
    grouped = frame.groupby("State/Region", as_index=False)[["Allocated_Amount", "Spent_Amount"]].sum(min_count=1)
    return grouped.sort_values("Allocated_Amount", ascending=False).to_dict("records")


def yearly_trends(frame: pd.DataFrame) -> list[dict]:
    grouped = frame[frame["Year"] > 0].groupby("Year", as_index=False)[
        ["Allocated_Amount", "Spent_Amount"]
    ].sum(min_count=1).sort_values("Year")
    grouped["growth_pct"] = grouped["Allocated_Amount"].pct_change().mul(100).round(2)
    grouped["growth_pct"] = grouped["growth_pct"].where(grouped["growth_pct"].notna(), 0)
    return grouped.to_dict("records")


def rankings(frame: pd.DataFrame) -> dict:
    output = {}
    for entity in ("Department", "Scheme"):
        grouped = frame.groupby(entity, as_index=False)[["Allocated_Amount", "Spent_Amount"]].sum()
        ranked = grouped.sort_values("Allocated_Amount", ascending=False)
        output[entity.lower()] = {
            "top": ranked.head(10).to_dict("records"),
            "bottom": ranked.tail(10).sort_values("Allocated_Amount").to_dict("records"),
        }
    return output


def anomaly_report(frame: pd.DataFrame) -> dict:
    grouped = frame.groupby("Department", as_index=False)[["Allocated_Amount", "Spent_Amount"]].sum(min_count=1)
    spending_available = summary(frame, {})["spending_available"]
    grouped["utilization_pct"] = pd.Series(index=grouped.index, dtype="float64")
    if spending_available:
        grouped["utilization_pct"] = grouped.apply(
            lambda row: row["Spent_Amount"] / row["Allocated_Amount"] * 100
            if row["Allocated_Amount"] else 0,
            axis=1,
        )
        underspent = grouped[grouped["utilization_pct"] < 60].copy()
        overspent = grouped[grouped["utilization_pct"] > 100].copy()
    else:
        underspent = grouped.iloc[0:0].copy()
        overspent = grouped.iloc[0:0].copy()
    values = grouped["Allocated_Amount"]
    if len(values) >= 4:
        q1, q3 = values.quantile([0.25, 0.75])
        iqr = q3 - q1
        spikes = grouped[(values > q3 + 1.5 * iqr) | (values < max(0, q1 - 1.5 * iqr))].copy()
    else:
        spikes = grouped.iloc[0:0].copy()
    return {
        "underspent": underspent.sort_values("utilization_pct").head(20).to_dict("records"),
        "overspent": overspent.sort_values("utilization_pct", ascending=False).head(20).to_dict("records"),
        "spikes_drops": spikes.sort_values("Allocated_Amount", ascending=False).head(20).to_dict("records"),
        "spending_available": spending_available,
        "method": "IQR on department allocations; utilization thresholds at 60% and 100%.",
    }


def insights(frame: pd.DataFrame) -> list[str]:
    if frame.empty:
        return ["No records match the current filters. Try widening your selection."]
    totals = summary(frame, {})
    departments = department_breakdown(frame)
    sectors = sector_breakdown(frame)
    messages = [f"{totals['department_count']} departments account for {totals['total_budget']:,.0f} in allocations."]
    if totals["utilization_pct"] is not None:
        messages.append(f"Overall budget utilization is {totals['utilization_pct']:.1f}%.")
    elif totals["spending_reported_rows"]:
        messages.append(
            f"Expenditure is reported for {totals['spending_reported_rows']} of {totals['row_count']} selected records; utilization is omitted."
        )
    else:
        messages.append("Expenditure is not reported for this budget period; utilization is unavailable.")
    if departments:
        messages.append(
            f"{departments[0]['Department']} has the largest allocation at "
            f"{departments[0]['Allocated_Amount']:,.0f}."
        )
    if sectors:
        messages.append(f"{sectors[0]['Sector']} is the largest sector at {sectors[0]['share_pct']:.1f}% of allocation.")
    trends = yearly_trends(frame)
    if len(trends) > 1:
        latest = trends[-1]
        messages.append(f"Latest-year allocation changed {latest['growth_pct']:+.1f}% year over year.")
    return messages