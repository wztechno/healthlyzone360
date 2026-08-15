<!--
    SYNTHETIC FIXTURE. Every name, class and note below was invented for this
    test suite. It carries the shape of the private Healthy360 kitchen workbook — the
    merged title and caveat rows, the ID prefixes, the allergen markers — and
    none of its content. Nothing here is a real formulation.
-->

Sheet1:Fixture Workbook — Ingredients, Sauces & Dressings

| Synthetic fixture data. No real formulation, cost or product name appears in this file. | Synthetic fixture data. No real formulation, cost or product name appears in this file. | Synthetic fixture data. No real formulation, cost or product name appears in this file. |
| --- | --- | --- |
|  | 1. Ingredients | A four-row stand-in for the platform ingredient master. |
|  | 2. Sauces | Four cooking sauces with their allergen classes and sources. |
|  | 3. Salad Dressings | Two dressings, same structure as the sauces. |
|  | Symbols & important notes |  |
|  | Tree nuts* | The asterisk marks a class that applies in one market and not the other. |
|  | Sulphites~ | The tilde marks a class to verify per supplier. |

Sheet2:1 · Ingredients Master (fixture)

| Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. | Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. | Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. | Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. | Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. | Fixture ingredient master. Allergen class from the EU-14 / US Big-9 framework; None = not a regulated allergen. |
| --- | --- | --- | --- | --- | --- |
| ID | Ingredient | Category | Sub-category | Allergen class | Notes |
| IG-001 | Fixture Flour | Grains & starches | Wheat-based | Cereals/Gluten |  |
| IG-002 | Fixture Coconut Cream | Fruits | Tropical fruit | Tree nuts* | * coconut: US allergen, not EU |
| IG-003 | Fixture Pickled Stem | Vegetables & other | Condiments / vinegars | Sulphites~ | ~ possible — verify per supplier |
| IG-004 | Fixture Rock Salt | Herbs & spices | Salt | None |  |

Sheet3:2 · Cooking Sauces (fixture)

| Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. | Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. | Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. | Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. | Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. | Four fixture cooking sauces. Allergen source names the exact ingredient that triggers each allergen class. |
| --- | --- | --- | --- | --- | --- |
| ID | Name | Typical ingredients | Allergen class(es) | Allergen source ingredient(s) | Notes |
| SC-01 | Demo Dip Sauce | Fixture tomato, fixture herb, oil, salt | None | — |  |
| SC-02 | Fixture Coconut Sauce | Fixture coconut cream, fixture spice blend (cumin, clove, bay), onion, oil | Tree nuts* | Tree nuts* — fixture coconut cream | * fixture coconut (US only) |
| SC-03 | Fixture Nut Cream Sauce | Fixture cashew, cream, onion, garlic | Tree nuts, Milk | Tree nuts — fixture cashew; Milk — cream / yogurt |  |
| SC-04 | Fixture Pickle Sauce | Fixture pickled stem, vinegar, sugar | Sulphites~ | Sulphites~ — vinegar | ~ verify supplier |
| Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. |

Sheet4:3 · Salad Dressings (fixture)

| Two fixture salad dressings, same structure as the sauces. | Two fixture salad dressings, same structure as the sauces. | Two fixture salad dressings, same structure as the sauces. | Two fixture salad dressings, same structure as the sauces. | Two fixture salad dressings, same structure as the sauces. | Two fixture salad dressings, same structure as the sauces. |
| --- | --- | --- | --- | --- | --- |
| ID | Name | Typical ingredients | Allergen class(es) | Allergen source ingredient(s) | Notes |
| DR-01 | Fixture Lemon Dressing | Lemon, oil, garlic, salt | None | — |  |
| DR-02 | Fixture Grain Dressing | Fixture grain (wheat), oil, lemon, sumac | Cereals/Gluten | Cereals/Gluten — fixture grain (wheat) |  |
| Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. | Ingredient lists in this fixture are invented and exist only to exercise the parser. |

Sheet5:4 · Allergen Class Key

| The allergen classes used to tag ingredients, sauces and dressings (EU-14 superset; US Big-9 flagged). | The allergen classes used to tag ingredients, sauces and dressings (EU-14 superset; US Big-9 flagged). |
| --- | --- |
| Allergen class | Note |
| Milk | All dairy. |
| Tree nuts | Almond, cashew, hazelnut, pistachio, walnut, pine nut, chestnut. |
| Tree nuts* | Coconut — a tree nut under US law, NOT an EU allergen. |
| Cereals/Gluten | Wheat and wheat-derived grains. |
| Sulphites~ | Possible in vinegar, dried fruit, pickles, molasses — verify per supplier. |
| None | Not a regulated allergen. |
