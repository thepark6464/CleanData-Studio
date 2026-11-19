import re
import pandas as pd


def _format_column_name(raw: str, convention: str) -> str:
    cleaned = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw.strip())
    cleaned = re.sub(r"[^a-zA-Z0-9]+", " ", cleaned).strip()
    if not cleaned:
        return "column"
    parts = cleaned.split()
    if convention == "snake_case":
        return "_".join(p.lower() for p in parts)
    if convention == "lowercase":
        return "".join(p.lower() for p in parts)
    if convention == "camelCase":
        return "".join(
            p.lower() if i == 0 else p[0].upper() + p[1:].lower()
            for i, p in enumerate(parts)
        )
    return raw.strip() or "column"


def rename_columns(
    df: pd.DataFrame, convention: str = "snake_case", custom_map: dict[str, str] | None = None
) -> tuple[pd.DataFrame, int, str]:
    out = df.copy()
    custom_map = custom_map or {}
    seen: set[str] = set()
    new_headers: list[str] = []
    renamed = 0

    for idx, header in enumerate(out.columns):
        if convention == "custom":
            candidate = str(custom_map.get(header, header)).strip() or f"column_{idx + 1}"
        else:
            candidate = _format_column_name(str(header), convention)

        if candidate in seen:
            suffix = 2
            while f"{candidate}_{suffix}" in seen:
                suffix += 1
            candidate = f"{candidate}_{suffix}"
        seen.add(candidate)
        if candidate != header:
            renamed += 1
        new_headers.append(candidate)

    out.columns = new_headers
    details = (
        f"Renamed {renamed} column header(s) ({convention})."
        if renamed > 0
        else "All column headers already match the selected convention."
    )
    return out, renamed, details
