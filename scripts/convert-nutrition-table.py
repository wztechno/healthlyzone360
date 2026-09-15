#!/usr/bin/env python3
"""Convert the owner's per-100 g nutrition table into the committed JSON document.

    python scripts/convert-nutrition-table.py <path-to-md>   # writes the JSON
    python scripts/convert-nutrition-table.py --self-test    # only the built-in checks

Output (path relative to the repo root this script lives under):
  apps/api/app-modules/ingredients/database/data/platform-ingredient-nutrition.json
      One row per platform ingredient (ING-001..306), each carrying the seven
      nutrients `IngredientNutritionSeeder` writes into
      `ingredients.nutrition_per_100g`, plus the provenance that stays in the
      file: the source's own note, whether the row is an estimate, and the
      reference URLs behind it.

**Separate from `platform-ingredients.json` on purpose.** That document is
regenerated from a workbook which is not in the repository
(`scripts/convert-v6-workbook.py`), and nutrition is not in the workbook. Two
generators writing one file is how a regeneration silently drops whatever the
other one added, so each writes its own and the seeders join them on
`source_ref`.

## The source

A markdown pipe table — `ID | Item | Calories | Protein | Carbohydrate | Fat |
Fiber | Sugars | Sodium | Nutrition Basis / Notes | Primary Source | Secondary
Source` — followed by a "Sheet2" legend block that restates the units in prose.
Only lines whose first cell is an `ING-###` reference are read, so the header,
the separator row and the whole legend are skipped by construction rather than
by counting lines.

Values are per 100 g: calories in kcal, the five macros in grams, sodium in
milligrams. Nothing is converted, rounded or rescaled here — a number in the
file is the number in the table.

## Densities are an input, not a transcription

The table says nothing about mass per unit, and 13 of the 306 ingredients are
stocked by the litre, so a recipe line reading "0.2 l soya sauce" has no grams
and therefore no nutrition. `GRAMS_PER_LITRE` below closes that, and it lives
here — in the generator, beside its own provenance — rather than being typed
into the JSON, so a re-conversion cannot drop it.

Three of the thirteen are estimates rather than measurements and say so in their
own note. The other 293 rows need no density at all: the owner's unit table
(2026-09) stocks every one of them by mass, so `gramsOf()` weighs them directly
and a figure here would be dead weight the ingredient service would clear.

It used to be two tables. The second held the rows a kitchen counted rather than
poured — eggs, at 50 g a piece — and six of these thirteen were ketchup,
mayonnaise and the four mustards, which the same table moved to kilograms. Both
groups are mass rows now.

`--self-test` parses a miniature table with every shape in it and asserts the
normalised output; it also runs automatically before every real conversion.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "apps/api/app-modules/ingredients/database/data/platform-ingredient-nutrition.json"

ROW = re.compile(r"^\|\s*(ING-\d{3})\s*\|")

# Column order of the source table, after the id: the seven numbers are
# positional, so the header is never read and never has to be.
NUMERIC_KEYS = [
    "energy_kcal",
    "protein_g",
    "carbohydrate_g",
    "fat_g",
    "fibre_g",
    "sugars_g",
    "sodium_mg",
]

USDA = "https://fdc.nal.usda.gov/"

# Grams in one litre, for the rows stocked by volume. Every figure is a USDA
# household-measure weight scaled to a litre, except the four that say
# "estimate" — those are a family figure or a physical assumption, and the note
# is what makes that visible downstream. Reviewed by the owner before seeding.
GRAMS_PER_LITRE = {
    "ING-003": (1000, "Aqueous solution; water-like density assumed (estimate)."),
    "ING-012": (1010, "USDA: 1 tbsp = 14.9 g."),
    "ING-013": (1080, "USDA: 1 tbsp = 16 g."),
    "ING-023": (1000, "Water."),
    "ING-025": (1000, "Water."),
    "ING-026": (1080, "USDA: 1 tbsp = 16 g."),
    "ING-030": (1320, "Sugar syrup at roughly 65 Brix (estimate)."),
    "ING-031": (1010, "USDA distilled vinegar: 1 tbsp = 14.9 g."),
    "ING-032": (1010, "USDA distilled vinegar: 1 tbsp = 14.9 g."),
    "ING-033": (1010, "USDA distilled vinegar: 1 tbsp = 14.9 g."),
    "ING-034": (1010, "USDA distilled vinegar: 1 tbsp = 14.9 g."),
    "ING-062": (1280, "USDA: 1 cup = 306 g."),
    "ING-067": (1030, "USDA: 1 cup = 244 g."),
}

# Density table -> the stock unit its figures are measured against.
#
# One table, where there were two. The second held eggs at 50 g a piece, and the owner's unit
# table (2026-09) moved that row to kilograms along with every other counted ingredient — so
# there is no `piece` row left to weigh, and a table with no rows is a shape to maintain rather
# than a fact to record. The 50 g figure survives in the migration that restates the recipe
# lines which used to say "4 piece".
GRAMS_PER_UNIT_TABLES = ((GRAMS_PER_LITRE, "l"),)

NOTICE = (
    "Per 100 g of the ingredient as purchased. Generic ingredients carry representative "
    "food-composition values; rows whose note begins \"Estimated\" are recipe-, brand-, salt- or "
    "preparation-dependent and are flagged rather than sourced. For purchasing, labelling or "
    "medical dietetics, replace an estimated row with the supplier's own label. "
    "`grams_per_unit` is the mass of one of the row's own stock units — a litre, for the thirteen "
    "rows stocked that way — and is supplied by this generator, not by the source table."
)


def number(cell: str) -> float | int:
    """The cell as a number, integral where the source writes one.

    `53.0` becomes `53` so the JSON reads like the table rather than like a
    float dump; `0.2` stays `0.2`. The seeder writes whichever it finds into a
    jsonb amount, so the distinction is cosmetic — but a reviewer comparing the
    document against the owner's table should not have to ignore a decimal
    point on every second line.
    """
    value = float(cell)

    return int(value) if value.is_integer() else value


def convert(text: str) -> dict:
    """The document, from the table's own text."""
    ingredients = []

    for line in text.splitlines():
        if not ROW.match(line):
            continue

        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]

        assert len(cells) == 12, f"{cells[0]}: expected 12 cells, got {len(cells)}"

        note = cells[9]
        row = {"source_ref": cells[0], "name_en": cells[1]}
        row |= {key: number(cells[index]) for index, key in enumerate(NUMERIC_KEYS, start=2)}
        row["note"] = note
        # The source's own hedge, promoted to a machine-readable flag. It stays
        # in the file rather than reaching the database: the owner's decision is
        # that provenance lives here and the columns hold numbers.
        row["estimated"] = note.lower().startswith("estimated")
        row["sources"] = [cells[10]] + ([cells[11]] if cells[11] else [])

        for table, unit in GRAMS_PER_UNIT_TABLES:
            if row["source_ref"] not in table:
                continue
            grams, basis = table[row["source_ref"]]
            row["grams_per_unit"] = grams
            # Named rather than assumed: the seeder writes the figure only when
            # the ingredient's *current* default unit still is this one, so an
            # operator who re-stocks soya sauce by the millilitre does not get a
            # per-litre mass relabelled onto it.
            row["grams_per_unit_of"] = unit
            row["grams_per_unit_note"] = basis

        ingredients.append(row)

    return {
        "source": "Ingredients_Sauces_Dressings_with_Nutrition.md",
        "generated_by": "scripts/convert-nutrition-table.py",
        "basis": "per_100g",
        "notice": NOTICE,
        "ingredients": ingredients,
    }


# ---------------------------------------------------------------- self-test

MINI_TABLE = """Sheet1

| ID | Item | Calories (kcal/100g) | Protein (g/100g) | Carbohydrate (g/100g) | Fat (g/100g) | Fiber (g/100g) | Sugars (g/100g) | Sodium (mg/100g) | Nutrition Basis / Notes | Primary Source | Secondary Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ING-001 | Baking powder | 53.0 | 0.0 | 28.1 | 0.0 | 0.2 | 0.0 | 10600 | Generic baking powder; sodium varies | https://fdc.nal.usda.gov/ | https://world.openfoodfacts.org/ |
| ING-006 | Tempura mix | 350.0 | 8.0 | 74.0 | 2.0 | 2.0 | 2.0 | 800 | Estimated generic dry tempura batter mix | https://fdc.nal.usda.gov/ | https://world.openfoodfacts.org/ |
| ING-026 | Soya sauce | 53.0 | 8.1 | 4.9 | 0.6 | 0.8 | 0.4 | 5493 | Generic soy sauce | https://fdc.nal.usda.gov/ |  |
| ING-207 | Eggs | 143.0 | 12.6 | 0.7 | 9.5 | 0.0 | 0.4 | 142 | Whole raw egg | https://fdc.nal.usda.gov/ |  |

Sheet2

| Nutrition enrichment | Values are per 100 g of the ingredient/product. |
| --- | --- |
| Energy | Calories are kcal per 100 g. |
"""


def self_test() -> None:
    doc = convert(MINI_TABLE)
    rows = {row["source_ref"]: row for row in doc["ingredients"]}

    # The legend block and both header rows are skipped, not counted away.
    assert doc["basis"] == "per_100g" and len(rows) == 4, doc

    baking = rows["ING-001"]
    assert baking["name_en"] == "Baking powder"
    assert baking["energy_kcal"] == 53 and isinstance(baking["energy_kcal"], int), baking
    assert baking["carbohydrate_g"] == 28.1 and baking["fibre_g"] == 0.2
    assert baking["sodium_mg"] == 10600 and baking["protein_g"] == 0
    assert baking["estimated"] is False
    assert baking["sources"] == [USDA, "https://world.openfoodfacts.org/"]
    assert "grams_per_unit" not in baking, "a mass-stocked row carries no density"

    assert rows["ING-006"]["estimated"] is True, "the source's own hedge is the flag"

    soy = rows["ING-026"]
    assert soy["sources"] == [USDA], "a blank secondary source is absent, not empty"
    assert soy["grams_per_unit"] == 1080 and soy["grams_per_unit_of"] == "l"
    assert soy["grams_per_unit_note"].startswith("USDA"), soy

    # Eggs used to be the one row weighed by the piece. The owner's unit table stocks them by mass
    # like everything else that was counted, so they now carry no density at all — and the row's
    # transcribed numbers are untouched by that, which is what this checks.
    eggs = rows["ING-207"]
    assert "grams_per_unit" not in eggs, "a mass-stocked row carries no density"
    assert eggs["energy_kcal"] == 143, "dropping the density does not disturb the numbers"

    # Round-trip: what is written is what is read back.
    assert json.loads(json.dumps(doc, ensure_ascii=False)) == doc

    # One row per ref per table, and every table's unit distinct — an ingredient is not stocked in
    # two units at once, and a ref in two tables would let the merge order decide what the figure
    # means. Trivially true while there is one table; the assert is what keeps it true if a second
    # is ever added back.
    units = [unit for _, unit in GRAMS_PER_UNIT_TABLES]
    assert len(units) == len(set(units)), "two density tables claim the same stock unit"
    seen: set[str] = set()
    for table, _ in GRAMS_PER_UNIT_TABLES:
        assert not seen & set(table), "a ref may name only one density table"
        seen |= set(table)

    assert all(grams > 0 for table, _ in GRAMS_PER_UNIT_TABLES for grams, _ in table.values())

    held = sum(len(table) for table, _ in GRAMS_PER_UNIT_TABLES)

    print(f"self-test OK ({len(rows)} rows parsed, {held} densities held)")


# ---------------------------------------------------------------- entrypoint

def main() -> None:
    self_test()

    if "--self-test" in sys.argv:
        return

    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]

    if not args:
        print("usage: convert-nutrition-table.py <path-to-md> | --self-test", file=sys.stderr)
        sys.exit(2)

    doc = convert(Path(args[0]).read_text(encoding="utf-8"))
    rows = doc["ingredients"]
    refs = [row["source_ref"] for row in rows]

    assert len(rows) == 306, f"expected 306 ING rows, got {len(rows)}"
    assert refs == [f"ING-{n:03d}" for n in range(1, 307)], "ids must be contiguous ING-001..306"
    assert all(row[key] >= 0 for row in rows for key in NUMERIC_KEYS), "a negative nutrient is a typo"
    for table, unit in GRAMS_PER_UNIT_TABLES:
        assert set(table) <= set(refs), f"a {unit} density names an ingredient the table does not"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    estimated = sum(1 for row in rows if row["estimated"])
    densities = sum(1 for row in rows if "grams_per_unit" in row)

    print(f"wrote {OUT.relative_to(REPO_ROOT)} ({len(rows)} ingredients)")
    print(f"{estimated} rows are flagged estimated by the source; {densities} carry a density")


if __name__ == "__main__":
    main()
