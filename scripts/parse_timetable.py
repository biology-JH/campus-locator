#!/usr/bin/env python3
"""Parse the school room timetable PDF into normalized JSON.

Requires Python's standard library and Poppler's pdftotext command. The web application
invokes this same parser when an authorized admin uploads a replacement timetable PDF.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

PDF_WIDTH = 792.0
GRID_LEFT = 52.08
DAY_WIDTH = 72.72
COLUMN_WIDTH = 8.08
PERIOD_COLUMNS = [
    ("mentor", "Mentor Group", 0),
    ("lesson1", "Lesson 1", 1),
    ("lesson2", "Lesson 2", 2),
    ("lesson3", "Lesson 3", 4),
    ("lesson4", "Lesson 4", 5),
    ("lesson5", "Lesson 5", 6),
    ("lesson6", "Lesson 6", 7),
    ("lesson7", "Lesson 7", 8),
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
ROOM_LABEL_X_LIMIT = 52.0
ROOM_FIRST_ROW_Y = 110.0
ROOM_LAST_ROW_Y = 580.0
ROW_HALF_HEIGHT = 23.4
SUBJECT_DICTIONARY_PATH = Path(__file__).resolve().parents[1] / "server/data/subject-abbreviations.json"


def _class_label(token: str) -> bool:
    return bool(re.fullmatch(r"\d{2}[A-Z]?", token.upper()))


def _letters(value: str) -> str:
    return re.sub(r"[^A-Z]", "", value.upper())


def _format_subject_display(value: str | None, dictionary: dict) -> str | None:
    if not value:
        return value
    tokens = value.split()
    roots = sorted(dictionary.get("byRoot", {}), key=len, reverse=True)
    aliases = {_letters(key): name for key, name in dictionary.get("aliases", {}).items()}
    for index, token in enumerate(tokens[:-1]):
        grade_match = re.fullmatch(r"(\d{2})[A-Z]?", token.upper())
        if not grade_match:
            continue
        grade = grade_match.group(1)
        combined = ""
        best = None
        end = index + 1
        while end < min(len(tokens), index + 7):
            token_letters = _letters(tokens[end])
            if not token_letters:
                break
            combined += token_letters
            if combined in roots:
                exact = dictionary.get("byShort", {}).get(f"{grade}{combined}", {})
                names = dictionary.get("byRoot", {}).get(combined, [])
                full_name = exact.get("fullName") or (names[0] if len(names) == 1 else None) or aliases.get(combined)
                if full_name:
                    best = (end, full_name)
            if combined in aliases:
                best = (end, aliases[combined])
            if not any(root.startswith(combined) for root in roots) and not any(alias.startswith(combined) for alias in aliases):
                break
            end += 1
        if not best:
            continue
        end, full_name = best
        consumed = "".join(tokens[index + 1:end + 1])
        suffix_match = re.search(r"\d+[A-Z]?$", consumed)
        suffix = suffix_match.group(0).rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ") if suffix_match else ""
        replacement = f"{full_name} {suffix}".strip()
        return " ".join(tokens[:index + 1] + [replacement] + tokens[end + 1:])
    return aliases.get(_letters(value), value)


def _staff_matches(tokens: list[dict], by_code: dict[str, list[dict]]) -> list[dict]:
    """Match abbreviations after each course's class/subject/group prefix.

    Staff initials in the PDF may wrap into separate words. Numeric class labels
    delimit concurrent entries, and slash-delimited initials can denote co-staff.
    """
    texts = [token["text"].strip() for token in tokens]
    starts: list[int] = []
    for index, text in enumerate(texts):
        if _class_label(text) and (not starts or index - starts[-1] >= 5):
            starts.append(index)
    ranges: list[tuple[int, int]] = []
    if starts:
        if starts[0] > 0:
            ranges.append((0, starts[0]))
        for position, start in enumerate(starts):
            end = starts[position + 1] if position + 1 < len(starts) else len(texts)
            ranges.append((min(start + 2, end), end))
    else:
        ranges.append((0, len(texts)))

    matches: list[dict] = []
    for range_start, range_end in ranges:
        index = range_start
        while index < range_end:
            if texts[index] in {"/", "&", "+"}:
                index += 1
                continue

            direct_code = texts[index].upper()
            if direct_code in by_code:
                matches.append({"code": direct_code, "indices": [index]})
                index += 1
                continue

            candidates: list[tuple[int, str, list[int]]] = []
            combined = ""
            for end in range(index, min(range_end, index + 5)):
                word = texts[end]
                if not re.fullmatch(r"[A-Za-z]{1,4}", word):
                    break
                combined += word.upper()
                if combined in by_code:
                    candidates.append((len(combined), combined, list(range(index, end + 1))))

            if candidates:
                _length, code, indices = max(candidates, key=lambda candidate: candidate[0])
                matches.append({"code": code, "indices": indices})
                index = indices[-1] + 1
            else:
                index += 1

    # A code may be printed twice for parallel groups in the same room cell.
    # Keep each occurrence for display replacement but expose each code once.
    unique_matches: list[dict] = []
    seen_occurrences: set[tuple[str, tuple[int, ...]]] = set()
    for match in matches:
        occurrence = (match["code"], tuple(match["indices"]))
        if occurrence not in seen_occurrences:
            seen_occurrences.add(occurrence)
            unique_matches.append(match)
    return unique_matches


def _display_without_resolved_staff(tokens: list[dict], matches: list[dict], by_code: dict[str, list[dict]]) -> str | None:
    removed_indices = {
        index
        for match in matches
        if len(by_code.get(match["code"], [])) == 1
        for index in match["indices"]
    }
    visible = []
    for index, token in enumerate(tokens):
        if index in removed_indices:
            continue
        if token["text"] in {"/", "&", "+"}:
            previous_removed = index > 0 and index - 1 in removed_indices
            next_removed = index + 1 < len(tokens) and index + 1 in removed_indices
            if previous_removed and next_removed:
                continue
        visible.append(token["text"])
    return " ".join(visible).strip() or None


def _clear_known_source_artifacts(rooms: list[dict]) -> None:
    suppression_path = Path(__file__).resolve().parents[1] / "server/data/timetable-cell-suppressions.json"
    suppressions = json.loads(suppression_path.read_text(encoding="utf-8"))
    rooms_by_name = {room["room"]: room for room in rooms}
    for suppression in suppressions:
        room = rooms_by_name.get(suppression["room"])
        if room is None:
            continue
        for cell in room["schedule"]:
            if (
                cell["week"] == suppression["week"]
                and cell["day"] == suppression["day"]
                and cell["period"] == suppression["period"]
                and cell["occupant"] is not None
                and cell["occupant"] == suppression["sourceText"]
            ):
                cell["occupant"] = None
                cell["occupantDisplay"] = None
                cell["staffCodes"] = []
                break


def parse_pdf(pdf_path: Path, staff_map_path: Path | None = None) -> dict:
    if not pdf_path.is_file():
        raise FileNotFoundError(pdf_path)

    by_code: dict[str, list[dict]] = {}
    subject_dictionary = json.loads(SUBJECT_DICTIONARY_PATH.read_text(encoding="utf-8"))
    if staff_map_path is not None:
        if not staff_map_path.is_file():
            raise FileNotFoundError(staff_map_path)
        staff_map = json.loads(staff_map_path.read_text(encoding="utf-8"))
        by_code = {
            code.upper(): people
            for code, people in staff_map.get("byCode", {}).items()
        }

    with tempfile.TemporaryDirectory(prefix="classroom-timetable-") as temp_dir:
        bbox_path = Path(temp_dir) / "timetable.xhtml"
        subprocess.run(
            ["pdftotext", "-bbox-layout", str(pdf_path), str(bbox_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        root = ET.parse(bbox_path).getroot()

    namespace = {"x": "http://www.w3.org/1999/xhtml"}
    pages = root.findall(".//x:page", namespace)
    if not pages or len(pages) > 100:
        raise ValueError(f"Expected between 1 and 100 timetable pages, found {len(pages)}")

    rooms: list[dict] = []
    for page_number, page in enumerate(pages, start=1):
        words = []
        for element in page.findall(".//x:word", namespace):
            word = "".join(element.itertext()).strip()
            if not word:
                continue
            x_min = float(element.get("xMin"))
            y_min = float(element.get("yMin"))
            x_max = float(element.get("xMax"))
            y_max = float(element.get("yMax"))
            words.append(
                {
                    "text": word,
                    "x": (x_min + x_max) / 2,
                    "y": (y_min + y_max) / 2,
                }
            )

        label_words = [
            word
            for word in words
            if word["x"] < ROOM_LABEL_X_LIMIT
            and ROOM_FIRST_ROW_Y < word["y"] < ROOM_LAST_ROW_Y
            and word["text"].lower() not in {"timetable", "generated"}
            and not re.fullmatch(r"20\d\d[/.-]\d+[/.-]\d+", word["text"])
        ]
        label_words.sort(key=lambda word: (word["y"], word["x"]))

        clusters: list[dict] = []
        for word in label_words:
            if clusters and abs(word["y"] - clusters[-1]["center"]) <= 5.0:
                cluster = clusters[-1]
                cluster["words"].append(word)
                cluster["center"] = sum(item["y"] for item in cluster["words"]) / len(cluster["words"])
            else:
                clusters.append({"center": word["y"], "words": [word]})

        # The room labels are centered vertically in evenly spaced 46.8pt table rows.
        # A small ±23.4pt band also works for the compact special-room page.
        for cluster in clusters:
            label = " ".join(word["text"] for word in sorted(cluster["words"], key=lambda item: item["x"]))
            if label.lower() in {"timetable", "timetable generated"}:
                continue
            room = {
                "room": label,
                "page": page_number,
                "schedule": [],
            }
            cells: dict[tuple[int, str], list[dict]] = defaultdict(list)
            for word in words:
                if word["x"] < GRID_LEFT or word["x"] >= PDF_WIDTH - 4:
                    continue
                if abs(word["y"] - cluster["center"]) > ROW_HALF_HEIGHT:
                    continue
                column = math.floor((word["x"] - GRID_LEFT) / COLUMN_WIDTH)
                if not 0 <= column < 90:
                    continue
                weekday_index, day_column = divmod(column, 9)
                if day_column == 3:  # Source timetable break; not one of the requested periods.
                    continue
                period = next(
                    (
                        period
                        for period, _label, source_column in PERIOD_COLUMNS
                        if source_column == day_column
                    ),
                    None,
                )
                if period is None:
                    continue
                cells[(weekday_index, period)].append(word)

            for weekday_index in range(10):
                week = "A" if weekday_index < 5 else "B"
                day = DAYS[weekday_index % 5]
                for period, _label, _column in PERIOD_COLUMNS:
                    tokens = sorted(
                        cells.get((weekday_index, period), []),
                        key=lambda item: (round(item["y"], 2), round(item["x"], 2)),
                    )
                    occupant = " ".join(token["text"] for token in tokens).strip() or None
                    matches = _staff_matches(tokens, by_code) if occupant and by_code else []
                    staff_codes = list(dict.fromkeys(match["code"] for match in matches))
                    room["schedule"].append(
                        {
                            "week": week,
                            "day": day,
                            "period": period,
                            "occupant": occupant,
                            "occupantDisplay": _format_subject_display(
                                _display_without_resolved_staff(tokens, matches, by_code)
                                if occupant and by_code
                                else occupant,
                                subject_dictionary,
                            ),
                            "staffCodes": staff_codes,
                        }
                    )
            rooms.append(room)

    _clear_known_source_artifacts(rooms)

    if not rooms or len(rooms) > 500:
        raise ValueError(f"Expected between 1 and 500 room rows in the source timetable, parsed {len(rooms)}")
    if len({room["room"] for room in rooms}) != len(rooms):
        raise ValueError("The source contains duplicate room labels after parsing")
    if any(len(room["schedule"]) != 80 for room in rooms):
        raise ValueError("Each room must have 80 Week/Day/Period records")

    occupied = sum(
        1
        for room in rooms
        for cell in room["schedule"]
        if cell["occupant"]
    )
    return {
        "school": "Yew Chung International School - Secondary",
        "address": "3 To Fuk Rd., Kowloon Tong",
        "sourceFile": pdf_path.name,
        "sourcePageCount": len(pages),
        "roomCount": len(rooms),
        "periods": [
            {"id": period, "label": label}
            for period, label, _column in PERIOD_COLUMNS
        ],
        "days": DAYS,
        "weeks": ["A", "B"],
        "occupiedCellCount": occupied,
        "teacherAbbreviationSource": staff_map.get("sourceFile") if staff_map_path is not None else None,
        "teacherCodeCount": len(by_code),
        "rooms": rooms,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="Source timetable PDF")
    parser.add_argument("output", type=Path, help="Destination JSON file")
    parser.add_argument(
        "--staff-map",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "server/data/teacher-abbreviations.json",
        help="Normalized JSON lookup generated from the teacher abbreviation workbook",
    )
    args = parser.parse_args()

    data = parse_pdf(args.pdf, args.staff_map)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Parsed {data['roomCount']} rooms, {data['occupiedCellCount']} occupied schedule cells, "
        f"and staff codes for {data['teacherAbbreviationSource']} "
        f"and {data['roomCount'] * 80} timetable cells into {args.output}"
    )


if __name__ == "__main__":
    main()
