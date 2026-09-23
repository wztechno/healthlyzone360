# Image audit — September 2026

An audit of the 100 photographs that were in `apps/universal/assets/images/` before the
ingredient and recipe imagery pass, carried out as step 2 of that work: what was covered, what
was duplicated, and what did not depict what it claimed to.

**Every finding below comes from looking at the image.** That matters, because the first pass of
this audit was done from `CREDITS.md` and got two of its conclusions backwards — see
_Withdrawn findings_ at the end. Metadata describes provenance, not subject.

---

## 1. Coverage

All 100 files carried a credit row in `CREDITS.md`: path, photographer, source URL and licence.
Coverage of the pre-existing set was complete and no orphan file or orphan row was found.

| family | files | distinct photographs |
| --- | ---: | ---: |
| `dishes/` | 40 | 20 |
| `plans/` | 16 | 8 |
| `kitchens/` | 12 | 6 |
| `diets/` | 13 | 13 |
| `dietitians/` | 5 | 5 |
| `discover/`, `how-it-works/`, `for-business/`, `landing/` | 14 | 14 |
| **total** | **100** | **66** |

What was **not** covered: ingredients and recipes had no imagery at all, and no field to carry
it. That is the gap this pass closes.

---

## 2. Duplicates

Parsed from the credit table: 100 rows, 100 source URLs, **66 distinct**, and no source used more
than twice. Every repeat is a `.card`/`.detail` pair cut from one photograph, which is a resolution
pair rather than a duplicate.

Two kinds of reuse existed across *records*, and they are not equivalent:

**Sanctioned — kept.** Forty prototype meals resolve onto twenty dish photographs, because a meal
and its larger-portion sibling are literally the same dish. D-035 states this and it remains true.

**Not sanctioned — removed.** Thirty-eight v6 catalogue meals were aliased onto the same twenty
photographs by "nearest visual family" in commit `fb7ec7c`, which described them in its own words
as "approximate stand-ins ... to be replaced when the kitchen's photography lands". They were not
portions of those dishes; they were different food. The alias table sent six separate breaded
chicken products — crispy chicken, nuggets, popcorn chicken, strips, zinger and escalope — to
`dishes/turkey-sweet-potato-hash`, a poached egg under sour cream and herbs.

**But none of it was ever on screen, which is a worse finding than the one it replaces.** The
block was keyed on the `meal-` prefix, and no v6 row produces one.
`MarketplaceMealPresenter.php:100` derives the id as `item_type.value + '-' + slug`, and
`ProductWriter.php:165` writes *every* imported row as `CatalogueItemType::Product` — nothing
reclassifies a dish to `Meal`. So those thirty-eight items resolve as `product-<slug>`, matched no
case in the resolver, and fell through to the generated pattern. The kitchen-admin path reaches the
same place by a different route: it reads the stored `image_placeholder_id` column, which the v6
import never writes.

So the thirty-eight had **no photograph at all**, while the codebase carried thirty-eight lines
asserting which photograph each one used. Dead code that documents a behaviour the system does not
have is worse than an honest gap, because it answers the question nobody then asks again.

Both are now fixed: the alias block is deleted, `product-` resolves alongside `meal-`, and
thirty-seven of the thirty-eight have their own reviewed photographs under `meals/`. The last, PRD-032
Sambousek Lahme, is reported as blocked rather than given a borrowed face again; see the final
coverage below. A test pins the
`product-` prefix specifically, because that is the thread the whole catalogue hangs on.

---

## 3. Relevance

Judged by inspection of each photograph against the record it decorates.

**Sound (16 of 20 dishes).** `garden-omelette-spinach`, `grilled-halloumi-rocket`,
`lemon-tahini-salmon`, `mint-yoghurt-chicken-skewers`, `morning-oats-dates-almonds`,
`pistachio-pomegranate-bowl`, `roasted-cauliflower-wrap`, `slow-braised-lamb-bulgur`,
`smoky-tofu-kale-bowl`, `spiced-lentil-pumpkin-stew`, `sunrise-labneh-sourdough`,
`tempeh-broccoli-stir-fry`, `calamari-rocket-salad`, `harbour-prawn-quinoa`,
`herbed-chicken-freekeh`, `turkey-sweet-potato-hash` all show the dish they name, or near enough
that a reader would not be misled. The last four are named for an ingredient that is present but
not conspicuous (the quinoa, the freekeh, the rocket, the sweet potato); that is ordinary food
photography, not a defect.

**Weak — named ingredient absent (4).** Recorded, not fixed: these are the prototype's own
synthetic world, they are declared synthetic on screen, and replacing them is outside this pass.

| file | names | shows |
| --- | --- | --- |
| `dishes/red-bean-pepper-chilli` | a cooked chilli | a bowl of **raw** kidney beans — the right ingredient in the wrong state |
| `dishes/charred-aubergine-chickpea` | charred aubergine with chickpeas | a chickpea salad; no aubergine visible |
| `dishes/courgette-walnut-pasta` | courgette and walnut pasta | macaroni in a tomato sauce; neither courgette nor walnut visible |
| `dishes/citrus-sea-bass-green-beans` | sea bass with green beans | fish with rice and salad; no green beans |

**Kitchens, plans, dietitians, diet hubs (36).** All appropriate. Kitchen interiors are
brand-neutral, portraits are plausible for the names they carry, diet hubs read as their category.

**One editorial concern.** `for-business/gym.tile` is a cropped bare male torso. It is licensed and
technically fine, but as the tile for a gym *partnership* on a food business's B2B page it is
off-message and out of keeping with every other image in the set. Flagged for a product decision;
not changed here, because it is neither an ingredient nor a recipe.

---

## 4. Metadata defects

**The alt text in `CREDITS.md` was misleading.** The `Source` column carried Unsplash's own
descriptive slugs, which are auto-generated and frequently wrong about the subject. Two examples
that caused real confusion during this audit:

- `dishes/red-bean-pepper-chilli` was credited via a URL reading `a-bowl-of-coffee-beans`. The
  photograph is kidney beans.
- `dishes/pistachio-pomegranate-bowl` was credited via `pink-flowers-beside-clear-glass-jar`. The
  photograph is yoghurt with pomegranate seeds and nuts, with flowers in the background.

Nothing was wrong with the *files*; the descriptions were never intended as subject labels. The fix
is structural: `CREDITS.md` is now generated from `provenance.json`, which records the source
title, creator, licence and licence URL as fields, and does not present any of them as a
description of what the photograph shows. Subject is established by review, and the review verdict
is recorded per image.

**The header made a claim that is no longer true.** It read "All images are from Unsplash … no
attribution required". New images come from Wikimedia Commons under a mixed licence policy where
many do require attribution. The generated header now states both policies and which files each
one governs.

---

## 5. Actions taken

| finding | action |
| --- | --- |
| 38 meals aliased onto borrowed photographs | `DISH_FOR_MEAL` v6 block deleted; 37 own photographs under `meals/`, 1 blocked |
| the aliases never fired — `product-` was unhandled, so those 38 showed nothing | `product-` resolves alongside `meal-`, pinned by test |
| ingredients and recipes had no imagery | sourced, with a machine-readable inventory defining coverage |
| `CREDITS.md` hand-maintained, no machine-readable provenance | generated from `provenance.json`; drift and coverage are now tested |
| header claimed no attribution is required | rewritten; the Unsplash-licensed files are grandfathered explicitly as `legacy` |
| 4 dish photographs missing their named ingredient | recorded above; not changed (prototype fixtures, declared synthetic) |
| `for-business/gym.tile` editorially off-message | recorded above; needs a product decision |

---

## Withdrawn findings

An earlier draft of this audit claimed `dishes/red-bean-pepper-chilli` and
`dishes/pistachio-pomegranate-bowl` showed the wrong subject entirely — coffee beans and flowers.
Both were wrong. They came from reading the Unsplash slug in the credit URL instead of opening the
file. The images are relevant; only the slugs were misleading. The corrected findings are in §3 and
§4 above, and the episode is the reason every relevance judgement in this pass, and every new image
sourced by it, is made by looking at the picture.

---

## Final coverage of the new imagery

Every record in `image-inventory.json` reached a reviewed disposition.

| set | imaged | of | share |
| --- | ---: | ---: | ---: |
| food ingredients | 295 | 318 | 93 % |
| packaging rows | 24 | 31 | 77 % |
| v6 meals | 37 | 38 | 97 % |
| recipes | 20 | 29 | 69 % |
| **total** | **376** | **416** | **90 %** |

Automated relevance was poor and review was not optional: the first pass was right 36 % of the time.
Commons is dense with homonyms for plain food words — Salmon returned a bear, Honey a clothing store,
Rocca (rocket) a castle, Cream the band, Cheddar the village, Printer roll a basket of bread rolls.

### Correction: the "exhausted" records were not exhausted

An earlier version of this section said 62 records had been refused "every candidate Commons offered"
across four reviewed passes. That was wrong. Each pass showed **one** ranked photograph per record, so
those 62 had had two or three photographs looked at in total — and the ranking systematically put dishes
made from an ingredient ahead of the ingredient ("Caramelized onion tarts" for caramelised onions,
"Chocolate chip cookies" for chocolate chips). Refused files also kept resurfacing until refusals were
persisted in the third pass.

The owner questioned it, rightly: these are ordinary foods. A grid of up to twelve candidates per record,
reviewed side by side, found a correct photograph for **52 of the 100 blocked records — 38 of the 62**.
Those were pinned in `source-overrides.json` and still passed every gate: the licence allowlist, the
uniqueness checks, and a review of the final crop.

### Widening the search beyond Commons

The owner asked for the search to go past Wikimedia Commons. It now reaches Flickr, rawpixel, StockSnap
and Nappy through [Openverse](https://openverse.org), the Creative Commons search engine, which needs no
account. The same allowlist applies, and Openverse's licence field is treated as a claim, not as proof:
before anything is downloaded, the photograph's own page is fetched and must link the Creative Commons
deed the licence names. That evidence is stored per image under `verified.at_source`, and every credit
names the library the photo came through ("via Flickr"), never assumes Commons.

The 48 records still blocked after the Commons grids each got a second grid of up to eighteen Openverse
candidates. Sixteen were picked and thirteen survived final-crop review, all from Flickr: condensed milk
lost to legible brand labels on the cans, herbes de Provence turned out to be loose tea at full size,
and the white-vinegar crop cut the bottle off. Unsplash, Pexels and Pixabay were not used; they need
registered API keys, and creating accounts is something the owner would need to do.

### The 40 still blocked

In `provenance.json` → `blocked[]`, each with its reason:

- `no_honest_photograph` (5) — marinades and a mid-preparation stage. No photograph of them exists as
  distinct from any other marinade, and a photograph of the finished dish is the substitution this work
  removed. Blocked by decision.
- `no_correct_candidate` (32) — both a Commons grid and an Openverse grid were reviewed and none showed
  the subject: the sauce-cup sizes and lids return drinking cups, the stock powders return soups and
  landscapes, sriracha returns only the trademarked rooster bottle, and several recipes return only the
  sandwiches or salads the sauce is one ingredient of.
- `no_candidates` (2) — nothing openly licensed exists under any name tried: Sambousek Lahme and the
  Lebanese burger patty.
- `licence_unverified_at_source` (1) — ING-072 Fish Filet. A good CC0 photograph exists on rawpixel, but
  rawpixel answers scripts with HTTP 403 and browsers here with a Cloudflare bot check, so the licence
  could not be confirmed on its own page and the photograph was not used. A person can open the page,
  confirm it, and pin it.

A blocked record renders the generated pattern placeholder, which is the designed fallback — never a
borrowed or approximate photograph.
