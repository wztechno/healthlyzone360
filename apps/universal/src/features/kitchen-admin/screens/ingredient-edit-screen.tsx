import type {
    AllergenClass,
    CostAmount,
    IngredientAdmin,
    LocalisedText,
    ReferenceSeries,
} from '@healthy360/api-client/contracts';
import {
    PACKAGING_CATEGORY_CODE,
    PRODUCT_FAMILY_CATEGORY_CODES,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    Dialog,
    ErrorState,
    FormGrid,
    FormIssueBanner,
    FormSection,
    FormSkeleton,
    Inline,
    QuantityInput,
    Select,
    Stack,
    Switch,
    Tag,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { FormIssueItem, SelectOption, TagTone } from '@healthy360/design-system';
import { IngredientId } from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { MEASURE_UNITS, coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import type { MeasureUnit, NutritionFacts } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    subcategoriesOf,
    topLevelCategories,
    useAllergenClassesQuery,
    useCreateIngredientMutation,
    useForkIngredientMutation,
    useIngredientCategoriesQuery,
    useIngredientPageQuery,
    useIngredientQuery,
    useNextReferenceQuery,
    useUpdateIngredientMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { DerivedPanel } from '../catalogue/derived-panel.tsx';
import type { DerivedFigure } from '../catalogue/derived-panel.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import {
    UNIT_DIMENSIONS,
    amountToInput,
    displayName,
    humaniseCode,
    marginPercent,
    parseAmount,
    parseQuantity,
    statusKey,
    statusTone,
    unitDimension,
    unitDimensionKey,
    unitKey,
    unitShortKey,
} from '../format.ts';
import { ImageSlot } from '../image-slot.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/ingredients/{ingredient}` — the record editor, as `Catalogue Forms.dc.html` draws it
 * (`isIngredient` and `isPackaging`).
 *
 * ```
 * New ingredient  DRAFT  ING-307                            [ Cancel ]  [ Save ]
 * ✖ 3 required  [ Designation (EN) ] [ Category ] [ Unit price ]   <- once Save is pressed
 * ───────────────────────────────────────────────────────────────────────────────
 * Description ──────────────────────────────────────────────────────────────────
 *   ┌╌╌╌╌╌╌┐  Item (EN)             Item (AR)
 *   ╎ (+)  ╎  Category              Sub-category
 *   └╌╌╌╌╌╌┘
 * Measurement & cost ────────────────────────────────────────────────────────────
 *   Purchase unit  Stock unit  Items per unit  Unit price
 * Sale ──────────────────────────────────────────────────────────────────────────
 *   ●━━  Available for sale
 *   B2B price  B2C price  Margin on cost
 * Nutrition · 100 g   ⚠ Estimated ──────────────────────────────────────────────
 *   Energy  Protein  Carbohydrate  Fat
 *   Fibre   Sugars   Sodium        Saturates
 * Allergens   ⓘ From database ──────────────────────────────────────────────────
 *   ( Egg ) ( Mustard )
 * ```
 *
 * One page, every section open at once, in the design's order. Sections, not cards: §1.3 retires
 * panel outlines in the Catalogue, so a section is a title, a hairline and its content.
 *
 * ## The half track
 *
 * Fields sit on `FormGrid`'s half track — 132px, two of them and their gap being exactly one 280px
 * field. A unit, a count or a price takes one; a designation, a category or a reference takes two.
 * That is still the no-stretch rule (§2), one size down: a two-character unit in a 280px box was the
 * last stretch left on this form, and the design sets four figures on the row where three fields
 * used to sit.
 *
 * ## Save always answers
 *
 * Save is pressable over an incomplete form. Pressing it marks the form *attempted*: the required
 * fields that are still empty say so under themselves, and one banner under the header names each
 * of them, each name taking the reader to its field. Before the first press nothing is flagged — a
 * new record opens with every required field blank, and a page of red before anyone has typed is
 * an accusation rather than help. A value that parses badly (a price of `abc`) is flagged at once,
 * because it is about something the reader has already typed.
 *
 * Every control is `sm` — 28px under the `compact` ladder `KitchenOpsShell` supplies — except Save,
 * the page's one `md`. Those numbers are only real under that provider; there is no second one here.
 *
 * ## Fields this screen used to have and the design does not
 *
 * Kitchen reference, Composition (made from), Other names and Notes are gone from the form, and so
 * is Archive. They are still on the record and still writable through the contract — this screen
 * simply stops being where they are edited.
 *
 * **They are therefore omitted from the write, never sent as empty.** `UpdateIngredientRequest`
 * treats a field it does not receive as untouched and an explicit `null` as a clear, so a form that
 * posted the four blanks it no longer collects would erase four columns on the first save of any
 * record that had them. The reference is still *read* — it opens the meta line, as the design draws
 * it — which is exactly the distinction the request has to preserve.
 *
 * ## Two facts from the design's meta line that nothing can back
 *
 * `used in 14 recipes` has no counterpart on `KitchenAdminRepository` at all, and `last costed` is
 * not `updatedAt` — a record whose name was corrected this morning has not been re-costed since
 * March. Reference and category lead the line as drawn; publication status and the changed line
 * follow, because a draft that looks published is the one mistake this header can prevent.
 *
 * ## Nutrition is typed here; allergens are still read-only — handoff §6.2
 *
 * The per-100 g figures used to sit in the read-only panel beside the allergen chips, on the
 * strength of "it resolves from the reference food database". That was true of the 306 seeded rows
 * and of nothing a kitchen creates: a row typed in here had seven blanks and no way to fill them,
 * and the 56 rows the reference document flags as estimated told the kitchen to replace them with a
 * supplier's label from a screen that offered no input. So they are inputs — seven required and
 * saturated fat optional — with the estimate flag and the source's own sentence beside them.
 *
 * **All seven or none.** A part-filled set is refused before the save, because the recipe roll-up
 * adds one nutrient at a time across every line and a missing term prints a label that understates
 * itself. The server accepts a partial set on purpose (completeness is the roll-up's question, not
 * the validator's), which is exactly why the refusal has to be here, in front of the person who can
 * fill the gap.
 *
 * **Except where the figures are a recipe's.** An ingredient a published version *outputs* — a
 * pesto mix — has its facts derived from the formulation that makes it, and the server refuses a
 * write to them. That record gets the read-only panel and a `Derived from a recipe` badge instead,
 * and the save sends nothing about nutrition at all: `null` would be a clear, and a refused clear
 * would fail the whole save including the name somebody came here to fix.
 *
 * Allergen classes still resolve from the reference food database and are still rendered for
 * confirmation on the sunken fill. No input, no override; a correction
 * happens on the reference record.
 *
 * The mapping editor that stood here wrote `setIngredientAllergens` and enforced D-041's
 * upgrade-only rule on platform baselines. Nothing else in the product writes that determination, so
 * the mapping is read-only everywhere until a screen is built for it. The quarantine banner stays:
 * an ingredient can still *arrive* in `review_required` from a write made elsewhere, and that is the
 * one fact this screen most needs to state.
 *
 * ## One lock version, one save
 *
 * A single write, carrying the lock version read from the query cache at the moment of saving rather
 * than held in state. A write that lands from anywhere else moves the version and the next save here
 * is refused with `resource.conflict`, which is what the conflict dialog exists for. The form
 * rehydrates from the server's answer and skips rehydration while it has unsaved edits, so a save
 * never discards a half-typed name.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    /** Read, never edited here — it opens the meta line. Not sent on save; see the note above. */
    readonly reference: string;
    readonly categoryCode: string;
    /** `''` means "filed at the top level" — the contract's `null`. */
    readonly subcategoryCode: string;
    readonly measurementUnit: MeasureUnit;
    /** `''` means "no purchase pack recorded" — an honest absence, not a default. */
    readonly purchaseUnit: MeasureUnit | '';
    readonly itemsPerUnit: string;
    /**
     * What one stock unit weighs, in grams. Asked only of a non-mass unit, and `''` clears it —
     * an unweighed litre is a real state the roll-up names rather than guesses at.
     */
    readonly gramsPerUnit: string;
    /** The three prices as typed. Parsed on save; `''` clears. */
    readonly unitPrice: string;
    readonly b2bPrice: string;
    readonly b2cPrice: string;
    readonly isSellable: boolean;
    /**
     * The per-100 g figures as typed, keyed by nutrient id — `''` for a field nobody has filled.
     *
     * Strings rather than numbers, like every other figure on this form: a half-typed `1.` is a
     * state a `number` cannot hold, and a draft that re-formatted what somebody was in the middle
     * of typing would move the caret while they typed it.
     */
    readonly nutrition: Readonly<Record<string, string>>;
    /**
     * `boolean`, though the contract's field has three states.
     *
     * A checkbox has two, and there is no third control to draw: "nobody has said" is the state of
     * a row nobody has opened, and this form is somebody opening it. So a save resolves the null —
     * which is exactly what the server does anyway, recording an unflagged set of facts as a
     * declaration.
     */
    readonly nutritionEstimated: boolean;
    readonly nutritionNote: string;
}

/**
 * The per-100 g figures this form collects, in the order the reference document writes them.
 *
 * Seven required and one optional, and that split is the roll-up's contract rather than a
 * preference: the recipe sum treats an ingredient missing one of the seven as unusable rather than
 * partially usable, because a blank is not a zero and a sum with a term missing prints a label that
 * understates itself. Saturated fat is outside the seven because the source table has no column for
 * it — a kitchen reading it off a packet can still record it, and the envelope carries it when they
 * do.
 *
 * Both keys are written out rather than assembled from the id. The two vocabularies are not the
 * same list and only look like it: `nutrientId` is the nutrition package's identifier and the
 * catalogue key is a translator-facing name, so `nutrition:nutrients.${id}` is a coincidence that
 * holds for some of these and breaks on the rest — and an interpolated key that does not exist is
 * an English string appearing in Arabic at run time instead of a compile error.
 */
const NUTRITION_FIELDS: readonly {
    readonly id: string;
    readonly labelKey: string;
    readonly unitKey: string;
    readonly required: boolean;
}[] = [
    {
        id: 'energy',
        labelKey: 'nutrition:nutrients.energy',
        unitKey: 'kitchen:nutritionFacts.unitKcal',
        required: true,
    },
    {
        id: 'protein',
        labelKey: 'nutrition:nutrients.protein',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: true,
    },
    {
        id: 'carbohydrate',
        labelKey: 'nutrition:nutrients.carbohydrate',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: true,
    },
    {
        id: 'fat',
        labelKey: 'nutrition:nutrients.fat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: true,
    },
    {
        id: 'fibre',
        labelKey: 'nutrition:nutrients.fibre',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: true,
    },
    {
        id: 'sugars',
        labelKey: 'nutrition:nutrients.sugars',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: true,
    },
    {
        id: 'sodium',
        labelKey: 'nutrition:nutrients.sodium',
        unitKey: 'kitchen:nutritionFacts.unitMilligrams',
        required: true,
    },
    {
        id: 'saturated_fat',
        labelKey: 'nutrition:nutrients.saturatedFat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
        required: false,
    },
];

const EMPTY_NUTRITION: Readonly<Record<string, string>> = Object.fromEntries(
    NUTRITION_FIELDS.map((field): readonly [string, string] => [field.id, '']),
);

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    reference: '',
    categoryCode: '',
    subcategoryCode: '',
    measurementUnit: 'g',
    purchaseUnit: '',
    itemsPerUnit: '',
    gramsPerUnit: '',
    unitPrice: '',
    b2bPrice: '',
    b2cPrice: '',
    isSellable: false,
    nutrition: EMPTY_NUTRITION,
    nutritionEstimated: false,
    nutritionNote: '',
};

function detailsFrom(ingredient: IngredientAdmin): DetailsDraft {
    return {
        name: ingredient.name,
        reference: ingredient.reference ?? '',
        categoryCode: ingredient.categoryCode,
        subcategoryCode: ingredient.subcategoryCode ?? '',
        measurementUnit: ingredient.measurementUnit,
        purchaseUnit: ingredient.purchaseUnit ?? '',
        itemsPerUnit: ingredient.itemsPerUnit === null ? '' : String(ingredient.itemsPerUnit),
        gramsPerUnit: ingredient.gramsPerUnit === null ? '' : String(ingredient.gramsPerUnit),
        unitPrice: amountToInput(ingredient.unitPrice),
        b2bPrice: amountToInput(ingredient.b2bPrice),
        b2cPrice: amountToInput(ingredient.b2cPrice),
        isSellable: ingredient.isSellable,
        nutrition: Object.fromEntries(
            NUTRITION_FIELDS.map((field): readonly [string, string] => {
                const amount =
                    ingredient.per100g === null ? null : findAmount(ingredient.per100g, field.id);

                // `String(value)`, not a formatter: this is the contents of an input, and a
                // thousands separator or a locale's decimal comma would be typed straight back
                // into a save as text that does not parse.
                return [field.id, amount === null ? '' : String(amount.value)];
            }),
        ),
        // `?? false`: the row's null is "nobody has said", and an unticked box is what that looks
        // like. Saving resolves it, which is the same answer the server reaches on its own.
        nutritionEstimated: ingredient.nutritionEstimated ?? false,
        nutritionNote: ingredient.nutritionNote ?? '',
    };
}

/**
 * The design's fields that nothing on the write path accepts yet — drawn, editable, and never sent.
 *
 * - **Image.** No image column exists on the ingredient, and no endpoint takes one.
 * - **Pack price, waste, holds** (packaging). `purchasePrice`, `wastePercent` and `capacity` are on
 *   `IngredientAdmin` — the import writes them and the packaging list reads them — but neither
 *   `CreateIngredientRequest` nor `UpdateIngredientRequest` carries any of the three, and the
 *   server's own request rules refuse them. So they open on the stored figures and a save leaves
 *   those figures as they were.
 *
 * Kept outside {@link DetailsDraft} on purpose. Editing one does not mark the record dirty — there
 * is nothing for the unsaved guard to protect, because nothing would have been saved — and none of
 * them can block the save, which is why the pack price carries no required mark here although the
 * design draws one. A required field whose value is thrown away is a gate with nothing behind it.
 */
interface UnstoredDraft {
    readonly image: string | null;
    readonly packPrice: string;
    readonly wastePercent: string;
    readonly capacity: string;
    readonly capacityUnit: MeasureUnit;
}

const EMPTY_UNSTORED: UnstoredDraft = {
    image: null,
    packPrice: '',
    wastePercent: '',
    capacity: '',
    capacityUnit: 'ml',
};

function unstoredFrom(ingredient: IngredientAdmin, image: string | null): UnstoredDraft {
    return {
        // The one field with no stored counterpart at all survives a rehydration rather than
        // resetting: a save answers with a record that has no image, and the photo somebody just
        // dropped should not vanish because the name was saved.
        image,
        packPrice: amountToInput(ingredient.purchasePrice),
        wastePercent: ingredient.wastePercent === null ? '' : String(ingredient.wastePercent),
        capacity: ingredient.capacity === null ? '' : String(ingredient.capacity.quantity),
        capacityUnit: ingredient.capacity?.unit ?? 'ml',
    };
}

/**
 * Above this, a packaging loss is flagged — the design's `Above 10%`. A warning and not a refusal:
 * a film that tears on the sealer really can lose a fifth, and saying so is the record doing its job.
 */
const WASTE_WARNING_PERCENT = 10;

/**
 * A typed nutrition figure, or `null` for blank and for anything that is not a number at or above
 * zero.
 *
 * Deliberately not {@link positiveNumberOf}. Zero is a real answer for a nutrient — water has no
 * protein, and `0 g` is a measurement rather than a gap — so a rule that threw it away would
 * silently drop the one figure a reader most wants to see stated. What is refused is a negative,
 * which is not a quantity of anything.
 */
function nutrientValueOf(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The typed figures as the contract's facts envelope.
 *
 * **Only `amounts` survives.** `kitchen-admin-writes` flattens this to the slim `{basis, amounts}`
 * the column actually holds, and the panels that render facts read the record the server sends
 * back, never this object — `mapIngredientPer100g` rebuilds the source and calculation lines from
 * the row's own timestamp and its estimate flag on every read. The rest of the envelope is here
 * because `NutritionFacts` is the shape the contract speaks, and it carries no user-facing copy for
 * exactly that reason: the two English strings below are the ones the mapper regenerates a moment
 * later, and nothing displays the pair written here.
 */
function per100gFrom(
    nutrition: Readonly<Record<string, string>>,
    recordedAt: string,
): NutritionFacts {
    return {
        basis: 'per_100g',
        kind: 'actual',
        serving: null,
        totalGrams: 100,
        amounts: NUTRITION_FIELDS.flatMap((field) => {
            const value = nutrientValueOf(nutrition[field.id] ?? '');
            // The canonical unit comes from the nutrient's own definition rather than a second
            // table here. It is not a label: the server refuses a nutrient stated in anything else,
            // because the roll-up sums across ingredients and a sum is only a sum when every term is
            // denominated the same way. A local copy would be a second answer waiting to disagree.
            const definition = coreNutrientDefinition(field.id);
            if (value === null || definition === null) return [];

            return [
                {
                    nutrientId: field.id,
                    unit: definition.unit,
                    value,
                    kind: 'actual' as const,
                    tolerance: null,
                },
            ];
        }),
        source: {
            kind: 'professional_entry',
            label: 'Kitchen-recorded reference facts',
            version: 'ingredient-record',
            calculatedAt: recordedAt,
        },
        calculation: {
            method: 'as_recorded',
            basis: 'per_100g',
            calculatedAt: recordedAt,
            prototype: false,
            rounding: 'as_entered',
            notes: [],
        },
    };
}

/**
 * A typed positive figure, or null for blank and for anything that is not one.
 *
 * Both of this form's bare numeric fields — items per pack, grams per unit — answer `null` to the
 * same three cases (blank, unparseable, not positive), and both contracts read `null` as "clear
 * it". One function rather than two identical ones.
 */
function positiveNumberOf(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The tiles a read-only record draws — the same eight the inputs collect, in the same order.
 *
 * A figure the record has not got comes back `null` and the panel draws an em dash in its place.
 * The row does not collapse to a sentence: see `DerivedPanel` for why an absent figure is still a
 * tile, and why it is never a zero. The unit is the bare unit — `kcal`, `g` — because the section
 * title already says `· 100 g`, and repeating the basis on eight tiles is eight times the same
 * words.
 */
function nutrientFigures(
    facts: NutritionFacts | null,
    t: TFunction,
    formatter: Formatter,
): readonly DerivedFigure[] {
    return NUTRITION_FIELDS.flatMap((field) => {
        const definition = coreNutrientDefinition(field.id);
        if (definition === null) return [];

        const amount = facts === null ? null : findAmount(facts, field.id);

        return [
            {
                key: field.id,
                label: t(field.labelKey),
                value:
                    amount === null
                        ? null
                        : formatter.formatNumber(amount.value, {
                              minimumFractionDigits: definition.precision,
                              maximumFractionDigits: definition.precision,
                          }),
                unit: t(field.unitKey),
            },
        ];
    });
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

/**
 * What differs between the two records this editor writes.
 *
 * A packaging row *is* an ingredient — same table, same contract, same lifecycle — filed under the
 * packaging branch and numbered in its own series. That is the whole difference, so it is four
 * fields rather than a second screen: the alternative was a copy of 1,100 lines that would drift
 * from this one the first time either changed.
 *
 * The same shape `ProductsScreen` already uses for Sauces and Dressings, and for the same reason.
 */
export interface IngredientEditFamily {
    /**
     * The series the server issues a next number in, or `null` where nothing issues one.
     *
     * `ReferenceSeries` is `ING-` | `RC-` | `SAC-` | `DRS-` — and **`PKG-` is not in it**. That is
     * not an oversight in this file, it is the contract: `IngredientReferenceSeries` (`ING-` |
     * `PKG-`) says which rows a *list* may ask for, and it is a different question from which
     * series a *counter* can advance. Packaging rows carry `PKG-001` handles — the import wrote
     * them — but no endpoint hands out the next one.
     *
     * So packaging passes `null`, the preview query is not run, and the Id field opens blank behind
     * its "Assigned on save" placeholder. The resale editor reaches the same conclusion from the
     * same contract for `RSL-`. Adding either series is a server change; inventing the number here
     * would offer a handle nothing stands behind.
     */
    readonly series: ReferenceSeries | null;
    /** Where Back and a successful create land. */
    readonly listRoute: string;
    /** The category this record is filed under, preset on a new one. */
    readonly categoryCode: string;
    /** Title on the create form. */
    readonly createTitleKey: string;
    /**
     * Whether this family's records are food, which decides two whole sections.
     *
     * **Sale** asks whether a raw material is sold as-is outside recipes. A bin liner is not: a
     * disposable a kitchen actually sells over the counter is a resale product with its own record,
     * its own packs and its own routes to market, and answering the question here would put a
     * second, weaker answer beside that one.
     *
     * **Composition & allergens** resolves nutrients and allergen classes from the reference food
     * database. Packaging has no entry there and never will, so the panel drew four em dashes and a
     * sentence explaining that it could not fill them — furniture, on the record where it is most
     * obviously furniture.
     *
     * Hidden, not cleared: `isSellable` and `per100g` stay on the contract and keep whatever the
     * record already holds, so nothing is destroyed by a family that declines to draw them.
     */
    readonly food: boolean;
}

/**
 * What a raw material may be stocked in.
 *
 * Two, and the list is the whole rule: `RecipeNutritionService` weighs a mass line directly and
 * bridges a volume one through `grams_per_unit`, and there is no third branch. Anything else makes
 * a line that cannot be weighed, which withholds the label of every recipe that names it.
 */
const STOCK_UNITS: readonly MeasureUnit[] = ['kg', 'l'];

/** What a packaging item's capacity is stated in — the design's four, volume first. */
const CAPACITY_UNITS: readonly MeasureUnit[] = ['ml', 'l', 'g', 'kg'];

export const INGREDIENT_FAMILY: IngredientEditFamily = {
    series: 'ING-',
    listRoute: '/kitchen/ingredients',
    categoryCode: '',
    createTitleKey: 'kitchen:editor.createTitle',
    food: true,
};

export const PACKAGING_FAMILY: IngredientEditFamily = {
    // No counter for `PKG-` — see `series` on the interface.
    series: null,
    listRoute: '/kitchen/packaging',
    categoryCode: PACKAGING_CATEGORY_CODE,
    createTitleKey: 'kitchen:packaging.createTitle',
    food: false,
};

export interface IngredientEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly ingredient: string | undefined;
    /** Defaults to the ingredient family, which is every existing caller. */
    readonly family?: IngredientEditFamily | undefined;
}

export function IngredientEditScreen({ ingredient, family }: IngredientEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredient-editor"
        >
            <IngredientEditor ingredient={ingredient} family={family} />
        </Gate>
    );
}

function IngredientEditor({ ingredient, family = INGREDIENT_FAMILY }: IngredientEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = ingredient === undefined || ingredient === 'new';
    const parsed = isCreating ? null : IngredientId.safeParse(ingredient);

    const record = useIngredientQuery(parsed);
    const classes = useAllergenClassesQuery();
    const categories = useIngredientCategoriesQuery();

    /**
     * One page of the catalogue, read for the one thing this record cannot answer about itself and
     * no resource declares: what currency the kitchen prices in. See {@link currency}.
     *
     * It used to carry the category hierarchy too, observed from the `categoryCode` /
     * `subcategoryCode` pairs on the page. That is now a real read — `useIngredientCategoriesQuery`
     * — and the derivation is gone with it.
     */
    const catalogue = useIngredientPageQuery(undefined, 1);
    /*
     * The handle this record is about to take — `ING-307` — read from the same scan the create
     * performs. Only while creating; a saved row has one of its own. It is a preview and not a
     * reservation, so two forms open at once are both shown it and the second save lands at 308.
     *
     * Disabled outright for a family the server issues no numbers for (see `series` above). The
     * prefix still has to be a real member of the union for the query key to type, so it falls back
     * to `ING-` — which is never fetched, because `enabled` is false in exactly that case.
     */
    const nextReference = useNextReferenceQuery(
        family.series ?? 'ING-',
        isCreating && family.series !== null,
    );

    const create = useCreateIngredientMutation();
    const update = useUpdateIngredientMutation();
    const fork = useForkIngredientMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);
    const [unstored, setUnstored] = useState<UnstoredDraft>(EMPTY_UNSTORED);

    /*
     * A new record opens already filed where the list that launched it looks.
     *
     * The packaging list asks the server for one branch by name, so a packaging record saved with
     * an empty category is written successfully and then does not appear on the page that created
     * it — which reads as a save that silently failed. Presetting it is the difference between a
     * form that knows where it came from and one that makes the reader guess.
     *
     * The ingredient family presets nothing, because there is no single branch it belongs to.
     */
    const [details, setDetails] = useState<DetailsDraft>(
        family.categoryCode === ''
            ? EMPTY_DETAILS
            : { ...EMPTY_DETAILS, categoryCode: family.categoryCode },
    );
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const data = record.data;

    /**
     * Whether this record is in the stored quarantine — read from the record, not remembered.
     *
     * It stays derived now that this screen no longer writes the mapping that used to produce it: an
     * ingredient can arrive quarantined from a write made anywhere else, and the K1.8 review queue
     * deep-links straight here. Remembering it in state would show no banner at all on the one path
     * that most needs one.
     */
    const quarantined = data?.meta.status === 'review_required';
    /**
     * The version the write is based on, read from the cache at save time rather than held in state.
     * A mutation writes its answer into the detail entry, so this is always the newest version this
     * client has seen — and a version somebody *else* moved is exactly what produces the conflict
     * the dialog exists for.
     */
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's values still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
        setUnstored(unstoredFrom(data, unstored.image));
    }

    const title = isCreating
        ? t(family.createTitleKey)
        : displayName(details.name, locale).value || t('kitchen:editor.editTitle');

    /*
     * The trail's last crumb, which is what makes `Ingredients` above it a link rather than the
     * current page — `Breadcrumbs` strips the press from the final item, so before this the one step
     * a reader wanted from a record was the one step the trail refused to take.
     *
     * The create form names itself too (`Kitchen workspace › Ingredients › New ingredient`): it has
     * no record to read a name from, but it is still a page below the list and still needs the way
     * back. Only a record that has not loaded yet leaves the leaf off, because there is nothing
     * truthful to put in it for the frame or two before it arrives.
     */
    useKitchenTrailLeaf(isCreating || data !== undefined ? title : null);

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    const settle = (nextDirty: boolean) => {
        setDetailsDirty(nextDirty);
        if (!nextDirty) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setDetailsKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    const classByCode = useMemo(() => {
        const map = new Map<string, AllergenClass>();
        for (const entry of classes.data ?? []) map.set(String(entry.code), entry);
        return map;
    }, [classes.data]);

    /**
     * Units, annotated by the dimension they belong to.
     *
     * Grouping matters because conversion only happens within a dimension (plan §4.5) — a picker
     * that offered grams and millilitres as one undifferentiated list would invite exactly the
     * choice the schema constraint exists to prevent. `Select` has no option-group API, so the
     * dimension travels in the option description and the list is ordered by it, which reads the
     * same way and needs no new design-system component.
     *
     * ## Food stocks in kilograms or litres, and the picker says so
     *
     * The owner's unit table: nutrition is only ever held per 100 g, so a raw material has to be
     * weighable, and a count has no mass without a per-piece figure nobody records. Offering
     * `piece` here is offering the state the library was just normalised out of — and it would
     * come back one ingredient at a time, which is how it arrived in the first place.
     *
     * Packaging keeps the full list. A cap is counted, a roll of film is a roll, and none of it
     * carries nutrition for a gram to matter to.
     *
     * `slice` and `portion` are gone from both. They have no `measurement_units` row, so
     * `MeasurementUnitLookup` could not resolve either and the write layer dropped the field
     * without a word — picking "Slices" saved nothing and reported success. They stay in
     * `MEASURE_UNITS` because they are the *serving* vocabulary the marketplace uses; they were
     * never stock units.
     */
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            UNIT_DIMENSIONS.flatMap((dimension) =>
                MEASURE_UNITS.filter(
                    (unit) =>
                        unitDimension(unit) === dimension &&
                        (family.food
                            ? STOCK_UNITS.includes(unit)
                            : unit !== 'slice' && unit !== 'portion'),
                ).map((unit) => ({
                    value: unit,
                    label: t(unitKey(unit)),
                    description: t(unitDimensionKey(dimension)),
                })),
            ),
        [t, family.food],
    );

    /**
     * The top level of the declared tree.
     *
     * Left in the catalogue's own order rather than re-sorted alphabetically: `displayOrder` is a
     * decision somebody made about how the categories should read, and an A–Z sort would discard
     * it. The record's own code is still appended when the tree does not contain it — a category
     * retired after this ingredient was filed under it — so the field never shows a placeholder
     * over a value that is really set.
     */
    const categoryOptions: readonly SelectOption[] = useMemo(() => {
        const known = new Map<string, SelectOption>();
        /*
         * A family that presets its branch offers that branch and nothing else.
         *
         * Packaging is filed under `packaging-disposables` and its list asks the server for that
         * one category by name, so a packaging record saved under Dairy is written successfully
         * and then absent from the page that created it - which a reader can only read as a save
         * that failed. The picker used to offer all eighteen top-level categories, which made that
         * one keystroke away. It is not a choice, so it stops being drawn as one; the sub-category
         * below still is, and is where the real filing decision is made.
         */
        const pinned =
            family.categoryCode === ''
                ? null
                : (topLevelCategories(categories.data).find(
                      (entry) => entry.code === family.categoryCode,
                  ) ?? null);

        /*
         * A raw material cannot be filed where the ingredient list would never show it.
         *
         * Sauce, Dressings, Beverage and Bread hold only finished goods, and the list keeps the
         * `ING-` series alone - so an ingredient filed under one of them would save successfully
         * and then be absent from the page that created it, which is the same trap the packaging
         * branch sets and the same answer. See `PRODUCT_FAMILY_CATEGORY_CODES`.
         */
        const offered =
            pinned === null
                ? topLevelCategories(categories.data).filter(
                      (entry) => !PRODUCT_FAMILY_CATEGORY_CODES.includes(entry.code),
                  )
                : [pinned];

        for (const entry of offered) {
            known.set(entry.code, {
                value: entry.code,
                label: displayName(entry.name, locale).value,
            });
        }
        if (details.categoryCode !== '' && !known.has(details.categoryCode)) {
            known.set(details.categoryCode, {
                value: details.categoryCode,
                label: humaniseCode(details.categoryCode),
            });
        }
        return [...known.values()];
    }, [categories.data, details.categoryCode, family.categoryCode, locale]);

    /**
     * The sub-category picker's options for the category currently chosen — the design's "options
     * follow the selected category", now read from the tree rather than inferred from it.
     *
     * This was derived until the contract grew `listIngredientCategories()`: one page of
     * ingredients, reduced to the `categoryCode` / `subcategoryCode` pairs that appeared on it.
     * Every leaf in this catalogue exists in the table — all 61 of them — but only the ones with
     * something already filed under them, on the first page, could be chosen. That is what made the
     * field look empty on most categories, and it is why the record's own leaf had to be seeded
     * into the set by hand to stop the picker omitting the value it was displaying. Reading the
     * declared tree needs neither trick.
     *
     * "Filed at the top level" still leads, because `subcategoryCode` is nullable and a picker with
     * no route back to null would make the first choice permanent. The record's own leaf is
     * appended when the tree has no such child — a retired leaf, or one moved to another branch —
     * for the same reason the category list does it.
     */
    const subcategoryOptions: readonly SelectOption[] = useMemo(() => {
        const known = new Map<string, SelectOption>();
        for (const entry of subcategoriesOf(categories.data, details.categoryCode)) {
            known.set(entry.code, {
                value: entry.code,
                label: displayName(entry.name, locale).value,
            });
        }
        if (details.subcategoryCode !== '' && !known.has(details.subcategoryCode)) {
            known.set(details.subcategoryCode, {
                value: details.subcategoryCode,
                label: humaniseCode(details.subcategoryCode),
            });
        }
        return [{ value: 'none', label: t('kitchen:fields.subcategoryNone') }, ...known.values()];
    }, [categories.data, details.categoryCode, details.subcategoryCode, locale, t]);

    /**
     * The currency the three prices are quoted in.
     *
     * Nothing on the session, the organisation or this contract publishes "the currency this kitchen
     * trades in" — the same gap `kitchen-admin-hooks.ts` records as 17 for delivery zones, and this
     * resolves it the same way that editor does. The record's own money first, because a priced
     * ingredient has already answered the question; then whatever the rest of the catalogue is
     * priced in, by frequency. `null` means the kitchen has priced nothing yet, and the price fields
     * say so rather than guessing a country's money.
     */
    const currency = useMemo<CurrencyCode | null>(() => {
        const own = [data?.unitPrice, data?.b2bPrice, data?.b2cPrice, data?.costPer100g];
        for (const cost of own) {
            if (cost !== null && cost !== undefined) return cost.currency;
        }

        const counts = new Map<CurrencyCode, number>();
        for (const row of catalogue.data?.items ?? []) {
            for (const cost of [row.unitPrice, row.b2bPrice, row.b2cPrice, row.costPer100g]) {
                if (cost === null) continue;
                counts.set(cost.currency, (counts.get(cost.currency) ?? 0) + 1);
            }
        }

        let best: CurrencyCode | null = null;
        let bestCount = 0;
        for (const [code, count] of counts) {
            if (count > bestCount) {
                best = code;
                bestCount = count;
            }
        }
        return best;
    }, [data, catalogue.data]);

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    // `isEditable` is the server's answer for *this* caller, not a property of the row: the shared
    // library is writable by the platform operator and read-only to every kitchen. Deriving it from
    // `organisationId === null` instead — which this screen used to do — made the 306 seeded rows
    // uneditable by everyone, including the operator who owns them.
    //
    // A record still loading has no answer yet, and read-only is the safe reading of one; the whole
    // form is disabled behind a skeleton at that point anyway. A *new* record is editable on
    // permission alone, because there is no row to ask about.
    const editable = canManage && (isCreating || (data?.isEditable ?? false));
    // The callout explains a read-only record. An operator who can edit this row does not need to
    // be told it is shared — the meta line already says so, and a banner over a working form reads
    // as a refusal.
    const platformNotice = data?.organisationId === null && !editable;

    const nameMissing = details.name.en.trim() === '';
    const categoryMissing = details.categoryCode.trim() === '';

    const unitPriceValue = parseAmount(details.unitPrice);
    const b2bPriceValue = parseAmount(details.b2bPrice);
    const b2cPriceValue = parseAmount(details.b2cPrice);

    // A price cannot be written without a currency to write it in, so an amount typed with no
    // currency resolved is a blocked save rather than a guess.
    const currencyMissing =
        currency === null &&
        [unitPriceValue, b2bPriceValue, b2cPriceValue].some((value) => typeof value === 'number');

    /*
     * Nutrition is typed here only where it is this screen's to type.
     *
     * Packaging has no entry in the reference food database and never will (see `food` on the
     * family), and an ingredient a published recipe *outputs* has its figures derived from that
     * formulation — the server refuses a write to either field while the link stands, so offering
     * the inputs would be offering a control whose save 422s.
     */
    const nutritionDerived = data?.nutritionDerivedFromVersionId ?? null;
    const nutritionEditable = family.food && nutritionDerived === null;

    /*
     * All seven, or none of them.
     *
     * A part-filled set is not a fact the roll-up can use. The recipe sum adds one nutrient at a
     * time across every line, so a missing term is not a smaller answer — it is a label that
     * understates itself with nothing on it to say so, which is the one failure a nutrition panel
     * cannot afford. The server accepts a partial set (an ingredient nobody has measured fat on is
     * a real row, and the *validator* is not where completeness is decided), so the refusal lives
     * here, where the person who can fix it is standing.
     *
     * "Filled" and "parses" are separate questions on purpose: a field holding `abc` or `-2` is
     * filled and does not parse, and blocking on it is what stops a typo from being saved as a
     * cleared figure.
     */
    const requiredNutrients = NUTRITION_FIELDS.filter((field) => field.required);
    const nutritionTouched = requiredNutrients.some(
        (field) => (details.nutrition[field.id] ?? '').trim() !== '',
    );
    const nutritionComplete = requiredNutrients.every(
        (field) => nutrientValueOf(details.nutrition[field.id] ?? '') !== null,
    );
    const nutritionPartial = nutritionEditable && nutritionTouched && !nutritionComplete;

    /*
     * The unit price is required of a new food record, as the design draws it: it is the figure a
     * raw material is costed at until a receipt says otherwise, and the margin under Sale divides by
     * it. Three limits on that, each load-bearing:
     *
     * - **Food only.** Packaging states its cost as a pack price instead (see `UnstoredDraft`).
     * - **On create only.** Hundreds of imported rows carry no list price, and a rule that refused
     *   every save of one would stop a kitchen correcting a name until somebody found a price.
     * - **Only once a currency is known.** A price cannot be written without one, so in a kitchen
     *   that has priced nothing yet the field would be required and unsaveable at the same time —
     *   a form nobody could ever submit.
     */
    const unitPriceMissing =
        family.food && isCreating && currency !== null && details.unitPrice.trim() === '';

    /*
     * Everything that stops the save, in the order the fields appear, each naming the field it is
     * about and the control that fixes it. The banner reads this list; the fields read the same
     * flags, so the two cannot disagree about what is wrong.
     *
     * `required` separates the two kinds: a blank that only matters once Save is pressed, against a
     * value already typed that does not parse — which is flagged as it is typed, and counted here so
     * a Save over it still says why nothing happened.
     */
    const blockers: readonly {
        readonly key: string;
        readonly label: string;
        readonly fieldId: string;
        readonly required: boolean;
    }[] = [
        ...(nameMissing
            ? [
                  {
                      key: 'name',
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:list.columnItem'),
                      }),
                      fieldId: 'kitchen-ingredient-name-en',
                      required: true,
                  },
              ]
            : []),
        ...(categoryMissing
            ? [
                  {
                      key: 'category',
                      label: t('kitchen:fields.category'),
                      fieldId: 'kitchen-ingredient-category',
                      required: true,
                  },
              ]
            : []),
        ...(unitPriceMissing || unitPriceValue === undefined
            ? [
                  {
                      key: 'unit-price',
                      label: t('kitchen:fields.unitPrice'),
                      fieldId: 'kitchen-ingredient-unit-price',
                      required: unitPriceMissing,
                  },
              ]
            : []),
        ...(b2bPriceValue === undefined
            ? [
                  {
                      key: 'b2b-price',
                      label: t('kitchen:sale.b2bPrice'),
                      fieldId: 'kitchen-ingredient-b2b-price',
                      required: false,
                  },
              ]
            : []),
        ...(b2cPriceValue === undefined
            ? [
                  {
                      key: 'b2c-price',
                      label: t('kitchen:sale.b2cPrice'),
                      fieldId: 'kitchen-ingredient-b2c-price',
                      required: false,
                  },
              ]
            : []),
        ...(nutritionPartial
            ? [
                  {
                      key: 'nutrition',
                      label: t('kitchen:forms.nutritionTitle'),
                      fieldId: `kitchen-ingredient-nutrient-${
                          requiredNutrients.find(
                              (field) =>
                                  nutrientValueOf(details.nutrition[field.id] ?? '') === null,
                          )?.id ?? 'energy'
                      }`,
                      required: false,
                  },
              ]
            : []),
    ];

    /*
     * The same list as the reader sees it: before the first Save, only what has already been typed
     * wrong; after it, everything.
     */
    const shownBlockers = attempted ? blockers : blockers.filter((entry) => !entry.required);
    const flag = (key: string, message: string): { readonly error?: string } =>
        shownBlockers.some((entry) => entry.key === key) ? { error: message } : {};
    const flagEnglish: { readonly englishError?: string } = shownBlockers.some(
        (entry) => entry.key === 'name',
    )
        ? { englishError: t('kitchen:forms.required') }
        : {};

    /*
     * Packaging's one caution: a loss above a tenth is unusual enough to say so. Never blocks — and
     * it could not, because the rate is not saved (see `UnstoredDraft`).
     */
    const wasteHigh =
        !family.food && (parseQuantity(unstored.wastePercent) ?? 0) > WASTE_WARNING_PERCENT;

    const blockerItems: readonly FormIssueItem[] = shownBlockers.map((entry) => ({
        key: entry.key,
        label: entry.label,
        onPress: () => {
            focusField(entry.fieldId);
        },
    }));
    const warningItems: readonly FormIssueItem[] = wasteHigh
        ? [
              {
                  key: 'waste',
                  label: t('kitchen:forms.waste'),
                  onPress: () => {
                      focusField('kitchen-ingredient-waste');
                  },
              },
          ]
        : [];

    /*
     * The denominator is `unitPrice`, which reads oddly beside the label until you read the
     * contract: `IngredientAdmin.unitPrice` is documented as "the denominator the editor's margin
     * readout divides `b2bPrice` by". `costPer100g` is what a kitchen actually *paid* and moves
     * with every receipt, so a margin against it would change without anybody editing this record.
     */
    const margin = marginPercent(b2bPriceValue, unitPriceValue);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /** A typed amount as the contract's `CostAmount`, or the null that clears it. */
    const costOf = (value: number | null | undefined): CostAmount | null =>
        typeof value === 'number' && currency !== null ? { amount: value, currency } : null;

    const save = () => {
        if (!editable || currencyMissing) return;
        setAttempted(true);
        if (blockers.length > 0) {
            // The banner names every field; the first one is also where the reader is taken.
            focusField(blockers[0]!.fieldId);
            return;
        }

        // The moment the figures were stated, for the envelope's own provenance line. Only
        // `amounts` reaches the server — which dates the row itself — so this is what the optimistic
        // copy shows until the next read replaces it.
        const recordedAt = new Date().toISOString();

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    categoryCode: details.categoryCode,
                    measurementUnit: details.measurementUnit,
                    ...(details.subcategoryCode === ''
                        ? {}
                        : { subcategoryCode: details.subcategoryCode }),
                    ...(details.purchaseUnit === '' ? {} : { purchaseUnit: details.purchaseUnit }),
                    ...(positiveNumberOf(details.itemsPerUnit) === null
                        ? {}
                        : { itemsPerUnit: positiveNumberOf(details.itemsPerUnit)! }),
                    ...(positiveNumberOf(details.gramsPerUnit) === null
                        ? {}
                        : { gramsPerUnit: positiveNumberOf(details.gramsPerUnit)! }),
                    ...(costOf(unitPriceValue) === null
                        ? {}
                        : { unitPrice: costOf(unitPriceValue)! }),
                    ...(costOf(b2bPriceValue) === null ? {} : { b2bPrice: costOf(b2bPriceValue)! }),
                    ...(costOf(b2cPriceValue) === null ? {} : { b2cPrice: costOf(b2cPriceValue)! }),
                    // Omitted rather than sent as null: a create has nothing to clear, and
                    // `CreateIngredientRequest` has no null state for any of the three.
                    ...(nutritionEditable && nutritionComplete
                        ? {
                              per100g: per100gFrom(details.nutrition, recordedAt),
                              nutritionEstimated: details.nutritionEstimated,
                              ...(details.nutritionNote.trim() === ''
                                  ? {}
                                  : { nutritionNote: details.nutritionNote.trim() }),
                          }
                        : {}),
                    isSellable: details.isSellable,
                },
                {
                    onSuccess: (created) => {
                        settle(false);
                        toast.show({
                            testID: 'kitchen-ingredient-created-toast',
                            tone: 'success',
                            message: t('kitchen:editor.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`${family.listRoute}/${String(created.id)}` as never);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        /*
         * Reference, composition, notes and aliases are absent on purpose, not forgotten: the form
         * no longer collects them, and `UpdateIngredientRequest` reads a missing field as untouched
         * and an explicit `null` as a clear. Sending the blanks would erase four columns.
         */
        update.mutate(
            {
                ingredientId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    categoryCode: details.categoryCode,
                    subcategoryCode:
                        details.subcategoryCode === '' ? null : details.subcategoryCode,
                    measurementUnit: details.measurementUnit,
                    purchaseUnit: details.purchaseUnit === '' ? null : details.purchaseUnit,
                    itemsPerUnit: positiveNumberOf(details.itemsPerUnit),
                    gramsPerUnit: positiveNumberOf(details.gramsPerUnit),
                    unitPrice: costOf(unitPriceValue),
                    b2bPrice: costOf(b2bPriceValue),
                    b2cPrice: costOf(b2cPriceValue),
                    /*
                     * Absent entirely on a record whose nutrition this screen does not own — a
                     * packaging row, or one a recipe derives. Absent is not the same as null here:
                     * `null` is a clear, and clearing a derivation is refused with a 422 that would
                     * fail the whole save, including the name somebody came here to fix.
                     *
                     * When the set is incomplete the save has already been blocked unless every
                     * field is blank, so the only `null` that reaches this line is a deliberate
                     * clear. The server clears the flag and the note beside it — the provenance
                     * belongs to the figures — so neither is sent.
                     */
                    ...(nutritionEditable
                        ? nutritionComplete
                            ? {
                                  per100g: per100gFrom(details.nutrition, recordedAt),
                                  nutritionEstimated: details.nutritionEstimated,
                                  nutritionNote:
                                      details.nutritionNote.trim() === ''
                                          ? null
                                          : details.nutritionNote.trim(),
                              }
                            : { per100g: null }
                        : {}),
                    isSellable: details.isSellable,
                },
            },
            {
                onSuccess: () => {
                    settle(false);
                    toast.show({
                        testID: 'kitchen-ingredient-saved-toast',
                        tone: 'success',
                        message: t('kitchen:editor.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const goBack = () => {
        router.push(family.listRoute as never);
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="md" testID="kitchen-ingredient-editor-screen">
                <Callout
                    testID="kitchen-ingredient-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:editor.notFoundTitle')}
                    body={t('kitchen:editor.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-ingredient-not-found-back"
                            variant="quiet"
                            size="sm"
                            label={t('kitchen:editor.backToList')}
                            onPress={goBack}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-ingredient-editor-loading"
                partTestID="kitchen-ingredient"
                sections={3}
            />
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="md" testID="kitchen-ingredient-editor-screen">
                <ErrorState
                    testID="kitchen-ingredient-load-error"
                    failure={loadFailure}
                    title={t('kitchen:editor.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    /**
     * Take a library row into this kitchen, then land on the copy.
     *
     * `router.replace`, not `push`: the library row is not somewhere the reader
     * wants to go back to — they came here to edit, and Back from the fork
     * should return to the catalogue, not to the read-only row they just left.
     *
     * The guard is not consulted. A platform row has no editable field, so
     * there is no draft to lose; `settle` is likewise unnecessary for the same
     * reason.
     */
    const forkForKitchen = (): void => {
        if (data === undefined) return;

        fork.mutate(data.id, {
            onSuccess: (created) => {
                toast.show({
                    testID: 'kitchen-ingredient-forked-toast',
                    tone: 'success',
                    message: t('kitchen:editor.forkedToast', {
                        name: displayName(created.name, locale).value,
                    }),
                });
                router.replace(`${family.listRoute}/${String(created.id)}` as never);
            },
        });
    };

    const forkFailure = toFailure(fork.error);

    const saveFailure = toFailure(update.error ?? create.error);
    const figures = nutrientFigures(data?.per100g ?? null, t, formatter);

    // Creating, the reference is the one the save is about to assign rather than one the record
    // carries. Empty while the read is in flight, and empty if it fails: better a blank than a
    // number nothing stands behind.
    const reference = isCreating ? (nextReference.data ?? '') : details.reference.trim();

    const busy = create.isPending || update.isPending;
    const priceUnit = currency === null ? {} : { unit: currency };

    /** One field of the draft, and the dirty flag with it — the shape every input below writes. */
    const edit = (patch: Partial<DetailsDraft>) => {
        setDetails({ ...details, ...patch });
        markDetailsDirty();
    };

    /** One of the fields nothing saves yet. No dirty flag: there is nothing for the guard to keep. */
    const editUnstored = (patch: Partial<UnstoredDraft>) => {
        setUnstored((current) => ({ ...current, ...patch }));
    };

    /*
     * Cost per item: the pack's price over the items in it — a figure somebody checks a delivery
     * note against. Empty rather than a zero when either half is missing, for the reason every
     * derived cell on this workspace gives: a `0.0000` would claim the item is free.
     */
    const packPriceValue = parseAmount(unstored.packPrice);
    const itemsPerPack = positiveNumberOf(details.itemsPerUnit);
    const costPerItem =
        typeof packPriceValue === 'number' && itemsPerPack !== null
            ? packPriceValue / itemsPerPack
            : null;

    const nutritionEmpty =
        nutritionEditable && !nutritionTouched && (data?.per100g ?? null) === null;
    const allergens = data?.allergens ?? [];

    const onlyRequired = shownBlockers.every((entry) => entry.required);

    /*
     * The purchase pack and the unit, drawn by both families — the pack first, because it is what
     * the delivery note states and what a reader copies from, and the stock unit is then how that
     * pack is broken down. Packaging calls the stock unit what it is on a packing bench — the unit an
     * item is issued in — and the design keeps the rest.
     */
    const unitFields = [
        <Select
            key="purchase-unit"
            testID="kitchen-ingredient-purchase-unit"
            id="kitchen-ingredient-purchase-unit"
            label={t('kitchen:fields.purchaseUnit')}
            placeholder={t('kitchen:fields.unitPlaceholder')}
            searchable
            disabled={!editable}
            options={[
                { value: 'none', label: t('kitchen:fields.purchaseUnitNone') },
                ...unitOptions,
            ]}
            value={details.purchaseUnit === '' ? 'none' : details.purchaseUnit}
            onChange={(next) => {
                edit({
                    purchaseUnit: next === 'none' ? '' : (next as DetailsDraft['purchaseUnit']),
                });
            }}
        />,
        <Select
            key="unit"
            testID="kitchen-ingredient-unit"
            id="kitchen-ingredient-unit"
            label={t(family.food ? 'kitchen:fields.stockUnit' : 'kitchen:forms.issueUnit')}
            placeholder={t('kitchen:fields.unitPlaceholder')}
            searchable
            disabled={!editable}
            options={unitOptions}
            value={details.measurementUnit}
            onChange={(next) => {
                /*
                 * The mass goes with the unit it was measured against.
                 *
                 * Load-bearing, not tidiness: this form always sends `gramsPerUnit` on a save, so a
                 * kg→l switch that kept the old figure would write the mass of a kilogram onto a
                 * litre — a plausible number nothing downstream can tell is wrong. The server clears
                 * it too, for the callers that are not this screen; here it also has to leave the
                 * field looking like what will be saved.
                 */
                edit({ measurementUnit: next as MeasureUnit, gramsPerUnit: '' });
            }}
        />,
        <QuantityInput
            key="items-per-unit"
            testID="kitchen-ingredient-items-per-unit"
            id="kitchen-ingredient-items-per-unit"
            size="sm"
            label={t(family.food ? 'kitchen:forms.itemsPerUnit' : 'kitchen:forms.itemsPerPack')}
            placeholder={t('kitchen:fields.itemsPerUnitPlaceholder')}
            value={details.itemsPerUnit}
            disabled={!editable}
            onChangeText={(next) => {
                edit({ itemsPerUnit: next });
            }}
        />,
    ];

    /*
     * Asked only where the answer is not already known.
     *
     * A kilogram weighs a kilogram; drawing this field beside a mass unit would be asking an
     * operator to restate the unit table, and whatever they typed would become a second source of
     * truth for it. A litre and a piece are the units that genuinely need weighing, and the roll-up
     * cannot convert their lines without this figure.
     */
    const gramsField =
        unitDimension(details.measurementUnit) === 'mass' ? null : (
            <QuantityInput
                testID="kitchen-ingredient-grams-per-unit"
                id="kitchen-ingredient-grams-per-unit"
                size="sm"
                label={t('kitchen:fields.gramsPerUnit', {
                    unit: t(unitShortKey(details.measurementUnit)),
                })}
                placeholder={t('kitchen:fields.gramsPerUnitPlaceholder')}
                unit={t(unitShortKey('g'))}
                value={details.gramsPerUnit}
                disabled={!editable}
                onChangeText={(next) => {
                    edit({ gramsPerUnit: next });
                }}
            />
        );

    const referenceField =
        (
            /*
             * Read, never written: the series is the server's to issue, and while creating this is the
             * number the save is about to take rather than one the record carries.
             */
            <TextInputField
                span={2}
                testID="kitchen-ingredient-reference"
                id="kitchen-ingredient-reference"
                label={t('kitchen:list.columnReference')}
                size="sm"
                placeholder={t('kitchen:fields.referencePlaceholder')}
                value={reference}
                disabled
                onChangeText={() => undefined}
            />
        );

    return (
        <Stack space="md" testID="kitchen-ingredient-editor-screen">
            {/*
             * The opening: the title with its status and handle beside it, Cancel and Save at the
             * inline end, the banners under it and one rule closing it. No trail here —
             * `KitchenOpsShell` draws it, and this screen names its last crumb instead.
             */}
            <Stack space="sm">
                <CataloguePageHeader
                    testID="kitchen-ingredient-editor-screen-header"
                    titleTestID="kitchen-ingredient-editor-screen-title"
                    title={title}
                    titleAside={
                        <Inline
                            space="xs"
                            align="center"
                            wrap
                            testID="kitchen-ingredient-editor-screen-meta"
                        >
                            <Badge
                                variant="caps"
                                testID="kitchen-ingredient-editor-screen-status"
                                tone={statusTone(data?.meta.status ?? 'draft')}
                                icon={null}
                                label={t(statusKey(data?.meta.status ?? 'draft'))}
                            />
                            {reference === '' ? null : (
                                <Text
                                    testID="kitchen-ingredient-editor-screen-identity"
                                    tone="secondary"
                                    variant="mono"
                                >
                                    {reference}
                                </Text>
                            )}
                            {guard.isDirty ? (
                                <Badge
                                    variant="label"
                                    testID="kitchen-ingredient-editor-screen-dirty"
                                    tone="warning"
                                    icon="warning"
                                    label={t('kitchen:editor.unsaved')}
                                />
                            ) : null}
                        </Inline>
                    }
                    primaryAction={
                        <Inline space="xs" align="center">
                            {/*
                             * Both `md`, matching the list page's `Import` and `New ingredient`
                             * pair — an editor's Cancel and Save are the same decision at the same
                             * weight. Save is hidden rather than permanently disabled on a record
                             * this caller cannot write: the callout below says why.
                             */}
                            <Button
                                testID="kitchen-ingredient-editor-screen-back"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(goBack);
                                }}
                            />
                            {platformNotice ? null : (
                                <Button
                                    testID="kitchen-ingredient-editor-screen-save"
                                    label={t('kitchen:editor.save')}
                                    loading={busy}
                                    disabled={!editable || currencyMissing || busy}
                                    onPress={save}
                                />
                            )}
                        </Inline>
                    }
                />

                {blockerItems.length === 0 && warningItems.length === 0 ? null : (
                    <Inline space="xs" wrap testID="kitchen-ingredient-issues">
                        {blockerItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-ingredient-issues-errors"
                                tone="danger"
                                summary={t(
                                    onlyRequired
                                        ? 'kitchen:forms.requiredCount'
                                        : 'kitchen:forms.toFixCount',
                                    { count: blockerItems.length },
                                )}
                                items={blockerItems}
                            />
                        )}
                        {warningItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-ingredient-issues-warnings"
                                tone="warning"
                                summary={t('kitchen:forms.warningCount', {
                                    count: warningItems.length,
                                })}
                                items={warningItems}
                            />
                        )}
                    </Inline>
                )}

                <View className="border-b border-stroke" />
            </Stack>

            {platformNotice ? (
                /*
                 * The notice states the constraint and offers the way out of it in the same breath.
                 * It used to state the constraint alone, which left "cannot be edited here" as a
                 * dead end — the row *can* be edited, once the kitchen takes a copy.
                 *
                 * The action is withheld from a reader without manage permission rather than shown
                 * disabled: forking is a write, and a control that exists only to be refused tells
                 * them less than its absence does.
                 */
                <Callout
                    testID="kitchen-ingredient-platform-library"
                    role="note"
                    tone="info"
                    title={t('kitchen:editor.platformLibraryTitle')}
                    body={t('kitchen:editor.platformLibraryBody')}
                    {...(canManage
                        ? {
                              actions: (
                                  <Button
                                      testID="kitchen-ingredient-fork"
                                      variant="secondary"
                                      size="sm"
                                      label={t('kitchen:editor.forkAction')}
                                      loading={fork.isPending}
                                      disabled={fork.isPending}
                                      onPress={forkForKitchen}
                                  />
                              ),
                          }
                        : {})}
                />
            ) : null}
            {forkFailure === null ? null : (
                <Callout
                    testID="kitchen-ingredient-fork-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:editor.forkError')}
                    body={forkFailure.message}
                />
            )}
            {quarantined ? (
                <Callout
                    testID="kitchen-ingredient-quarantine"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:allergens.quarantineTitle')}
                    body={t('kitchen:allergens.quarantineBody')}
                />
            ) : null}
            {saveFailure === null ? null : (
                <Callout
                    testID="kitchen-ingredient-save-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:editor.saveError')}
                    body={saveFailure.message}
                />
            )}
            {currencyMissing ? (
                <Callout
                    testID="kitchen-ingredient-currency-missing"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:sale.currencyUnknown')}
                />
            ) : null}

            {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
            <View className="z-auto flex-col gap-loose">
                {/* ── identity ─────────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-ingredient-identity"
                    title={t('kitchen:forms.description')}
                >
                    <View className="z-auto flex-row flex-wrap items-start gap-base">
                        {/*
                         * The photo leads a food record and packaging has none — a bin liner is
                         * identified by its reference, and the design draws no slot for it. Not
                         * saved yet: see `UnstoredDraft`.
                         */}
                        {!family.food ? null : (
                            <ImageSlot
                                testID="kitchen-ingredient-image"
                                uri={unstored.image}
                                disabled={!editable}
                                onChange={(next) => {
                                    editUnstored({ image: next });
                                }}
                            />
                        )}

                        {/*
                         * Beside the photo a food record has four half tracks, which is two 280px
                         * fields — the item pair on the first row, the filing on the second. It
                         * draws no reference field: the handle is beside the title already, and a
                         * read-only box repeating it was a field nobody could use. Packaging has no
                         * photo and opens on its handle, so the reference leads and the row takes
                         * all six.
                         */}
                        <FormGrid
                            track="half"
                            {...(family.food ? { maxColumns: 4 } : {})}
                            testID="kitchen-ingredient-identity-grid"
                        >
                            {/*
                             * Not on a new record either: nothing has been issued yet, so the box
                             * could only ever say "Assigned on save". The handle is beside the
                             * title once it exists.
                             */}
                            {family.food || isCreating ? null : referenceField}

                            {/*
                             * One `BilingualField` rather than two inputs, because that component
                             * owns the per-language writing direction; `row` puts the halves side
                             * by side inside the four tracks `span={4}` claims.
                             */}
                            <BilingualField
                                span={4}
                                layout="row"
                                testID="kitchen-ingredient-name"
                                fieldLabel={t('kitchen:list.columnItem')}
                                placeholder={
                                    family.food
                                        ? {
                                              en: t('kitchen:fields.ingredientNamePlaceholderEn'),
                                              ar: t('kitchen:fields.ingredientNamePlaceholderAr'),
                                          }
                                        : {
                                              en: t('kitchen:fields.packagingNamePlaceholderEn'),
                                              ar: t('kitchen:fields.packagingNamePlaceholderAr'),
                                          }
                                }
                                value={details.name}
                                requiredEnglish
                                disabled={!editable}
                                {...flagEnglish}
                                onChange={(next) => {
                                    edit({ name: next });
                                }}
                            />

                            <Select
                                span={2}
                                testID="kitchen-ingredient-category"
                                id="kitchen-ingredient-category"
                                label={t('kitchen:fields.category')}
                                placeholder={t('kitchen:fields.categoryPlaceholder')}
                                searchable
                                required
                                // Locked for a family whose branch is the family - see
                                // `categoryOptions`.
                                disabled={!editable || family.categoryCode !== ''}
                                options={categoryOptions}
                                value={details.categoryCode === '' ? null : details.categoryCode}
                                {...flag('category', t('kitchen:forms.required'))}
                                onChange={(next) => {
                                    // Changing the parent invalidates the leaf: a sub-category
                                    // from the previous branch would be refused on save.
                                    edit({ categoryCode: next, subcategoryCode: '' });
                                }}
                            />

                            <Select
                                span={2}
                                testID="kitchen-ingredient-subcategory"
                                id="kitchen-ingredient-subcategory"
                                label={t('kitchen:fields.subcategory')}
                                placeholder={t('kitchen:fields.subcategoryPlaceholder')}
                                searchable
                                disabled={!editable || details.categoryCode === ''}
                                options={subcategoryOptions}
                                value={
                                    details.subcategoryCode === ''
                                        ? 'none'
                                        : details.subcategoryCode
                                }
                                onChange={(next) => {
                                    edit({ subcategoryCode: next === 'none' ? '' : next });
                                }}
                            />
                        </FormGrid>
                    </View>
                </FormSection>

                {/* ── measurement & cost / pack ────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-ingredient-measurement"
                    title={t(
                        family.food ? 'kitchen:editor.sectionMeasurement' : 'kitchen:forms.pack',
                    )}
                >
                    <FormGrid track="half" testID="kitchen-ingredient-measurement-grid">
                        {unitFields}

                        {/*
                         * `QuantityInput`, not `TextInputField`: every figure on this screen is set
                         * in the mono role, flush to the trailing edge (§1.2). The currency rides in
                         * the unit slot as a static suffix — a price carrying its own currency is a
                         * string no cost cascade can multiply.
                         */}
                        {!family.food ? null : (
                            <QuantityInput
                                testID="kitchen-ingredient-unit-price"
                                id="kitchen-ingredient-unit-price"
                                size="sm"
                                required={isCreating && currency !== null}
                                label={t('kitchen:fields.unitPrice')}
                                placeholder={t('kitchen:fields.unitPricePlaceholder')}
                                value={details.unitPrice}
                                disabled={!editable}
                                {...priceUnit}
                                {...flag(
                                    'unit-price',
                                    unitPriceMissing
                                        ? t('kitchen:forms.required')
                                        : t('kitchen:sale.priceInvalid'),
                                )}
                                onChangeText={(next) => {
                                    edit({ unitPrice: next });
                                }}
                            />
                        )}

                        {/*
                         * What one item holds, in two cells: the figure and its unit. Packaging
                         * only — a cap or a label holds nothing and leaves it blank. Not saved yet:
                         * see `UnstoredDraft`.
                         */}
                        {family.food ? null : (
                            <QuantityInput
                                testID="kitchen-ingredient-capacity"
                                id="kitchen-ingredient-capacity"
                                size="sm"
                                label={t('kitchen:forms.holds')}
                                placeholder={t('kitchen:fields.quantityPlaceholder')}
                                value={unstored.capacity}
                                disabled={!editable}
                                onChangeText={(next) => {
                                    editUnstored({ capacity: next });
                                }}
                            />
                        )}
                        {family.food ? null : (
                            <Select
                                testID="kitchen-ingredient-capacity-unit"
                                id="kitchen-ingredient-capacity-unit"
                                label={t('kitchen:forms.holdsUnit')}
                                placeholder={t('kitchen:fields.unitPlaceholder')}
                                disabled={!editable}
                                options={CAPACITY_UNITS.map((unit) => ({
                                    value: unit,
                                    label: t(unitShortKey(unit)),
                                }))}
                                value={unstored.capacityUnit}
                                onChange={(next) => {
                                    editUnstored({ capacityUnit: next as MeasureUnit });
                                }}
                            />
                        )}

                        {gramsField}
                    </FormGrid>
                </FormSection>

                {/* ── cost (packaging) ─────────────────────────────────────────────────────── */}
                {family.food ? null : (
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-ingredient-cost"
                        title={t('kitchen:forms.cost')}
                    >
                        <FormGrid track="half" testID="kitchen-ingredient-cost-grid">
                            <QuantityInput
                                testID="kitchen-ingredient-pack-price"
                                id="kitchen-ingredient-pack-price"
                                size="sm"
                                label={t('kitchen:packaging.columnPackPrice')}
                                placeholder={t('kitchen:fields.unitPricePlaceholder')}
                                value={unstored.packPrice}
                                disabled={!editable}
                                {...priceUnit}
                                {...(packPriceValue === undefined
                                    ? { error: t('kitchen:sale.priceInvalid') }
                                    : {})}
                                onChangeText={(next) => {
                                    editUnstored({ packPrice: next });
                                }}
                            />
                            <QuantityInput
                                testID="kitchen-ingredient-waste"
                                id="kitchen-ingredient-waste"
                                size="sm"
                                label={t('kitchen:forms.waste')}
                                placeholder={t('kitchen:fields.percentPlaceholder')}
                                unit="%"
                                value={unstored.wastePercent}
                                disabled={!editable}
                                {...(wasteHigh
                                    ? {
                                          warning: t('kitchen:forms.aboveWaste', {
                                              percent: WASTE_WARNING_PERCENT,
                                          }),
                                      }
                                    : {})}
                                onChangeText={(next) => {
                                    editUnstored({ wastePercent: next });
                                }}
                            />
                            {/*
                             * The derived third cell, in the `readOnly` variant — a figure on the
                             * sunken fill, in a field's shape, that nobody types into. Four places:
                             * a cap costs a fraction of a unit, and two would round it to nothing.
                             */}
                            <QuantityInput
                                testID="kitchen-ingredient-cost-per-item"
                                id="kitchen-ingredient-cost-per-item"
                                size="sm"
                                readOnly
                                label={t('kitchen:forms.costPerItem')}
                                placeholder={t('kitchen:sale.marginUnavailable')}
                                {...priceUnit}
                                value={
                                    costPerItem === null
                                        ? ''
                                        : formatter.formatNumber(costPerItem, {
                                              minimumFractionDigits: 4,
                                              maximumFractionDigits: 4,
                                          })
                                }
                                onChangeText={() => undefined}
                            />
                        </FormGrid>
                    </FormSection>
                )}

                {/* ── sale (food) ──────────────────────────────────────────────────────────── */}
                {!family.food ? null : (
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-ingredient-sale"
                        title={t('kitchen:sale.title')}
                    >
                        <Stack space="sm">
                            <Switch
                                testID="kitchen-ingredient-sellable"
                                id="kitchen-ingredient-sellable"
                                label={t('kitchen:sale.toggleLabel')}
                                checked={details.isSellable}
                                disabled={!editable}
                                onChange={(next) => {
                                    edit({ isSellable: next });
                                }}
                            />

                            {/*
                             * The prices appear only while the ingredient is sold. They are not
                             * cleared on toggling off: an ingredient taken off sale for a season
                             * keeps the prices it had, and re-listing it is one switch.
                             */}
                            {details.isSellable ? (
                                <FormGrid track="half" testID="kitchen-ingredient-sale-grid">
                                    <QuantityInput
                                        testID="kitchen-ingredient-b2b-price"
                                        id="kitchen-ingredient-b2b-price"
                                        size="sm"
                                        label={t('kitchen:sale.b2bPrice')}
                                        placeholder={t('kitchen:fields.unitPricePlaceholder')}
                                        value={details.b2bPrice}
                                        disabled={!editable}
                                        {...priceUnit}
                                        {...flag('b2b-price', t('kitchen:sale.priceInvalid'))}
                                        onChangeText={(next) => {
                                            edit({ b2bPrice: next });
                                        }}
                                    />
                                    <QuantityInput
                                        testID="kitchen-ingredient-b2c-price"
                                        id="kitchen-ingredient-b2c-price"
                                        size="sm"
                                        label={t('kitchen:sale.b2cPrice')}
                                        placeholder={t('kitchen:fields.unitPricePlaceholder')}
                                        value={details.b2cPrice}
                                        disabled={!editable}
                                        {...priceUnit}
                                        {...flag('b2c-price', t('kitchen:sale.priceInvalid'))}
                                        onChangeText={(next) => {
                                            edit({ b2cPrice: next });
                                        }}
                                    />
                                    {/*
                                     * Empty rather than a stand-in figure when the sum cannot be
                                     * stated: the placeholder's em dash says "not calculable",
                                     * where a `0.0` would claim the margin is nil.
                                     */}
                                    <QuantityInput
                                        testID="kitchen-ingredient-margin"
                                        id="kitchen-ingredient-margin"
                                        size="sm"
                                        readOnly
                                        label={t('kitchen:sale.margin')}
                                        unit="%"
                                        placeholder={t('kitchen:sale.marginUnavailable')}
                                        value={
                                            margin === null
                                                ? ''
                                                : formatter.formatNumber(margin, {
                                                      minimumFractionDigits: 1,
                                                      maximumFractionDigits: 1,
                                                      signDisplay: 'exceptZero',
                                                  })
                                        }
                                        onChangeText={() => undefined}
                                    />
                                </FormGrid>
                            ) : null}
                        </Stack>
                    </FormSection>
                )}

                {/* ── nutrition · 100 g (food) ─────────────────────────────────────────────── */}
                {!family.food ? null : (
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-ingredient-nutrition"
                        title={t('kitchen:forms.nutritionTitle')}
                        aside={
                            /*
                             * Where the figures stand, as labels on the heading rather than a
                             * paragraph under it: derived from a recipe, read from the shared
                             * library, flagged as an estimate, or not recorded at all.
                             */
                            <Inline space="xs" align="center" wrap>
                                {nutritionDerived !== null ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-nutrition-derived"
                                        tone="info"
                                        label={t('kitchen:nutritionFacts.derivedBadge')}
                                    />
                                ) : data?.organisationId === null ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-nutrition-source"
                                        tone="info"
                                        label={t('kitchen:composition.fromDatabase')}
                                    />
                                ) : null}
                                {details.nutritionEstimated ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-nutrition-estimated-badge"
                                        tone="warning"
                                        label={t('kitchen:nutritionFacts.estimatedBadge')}
                                    />
                                ) : null}
                                {nutritionEmpty ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-nutrition-empty"
                                        tone="warning"
                                        label={t('kitchen:forms.noFigures')}
                                    />
                                ) : null}
                            </Inline>
                        }
                    >
                        {nutritionDerived === null ? (
                            <Stack space="sm">
                                {/*
                                 * The same cards the recipe's technical sheet draws, with the
                                 * figure typed into the card itself: one shape for an ingredient's
                                 * nutrition and a recipe's, which is how the design sets them.
                                 *
                                 * A part-filled set marks only the gaps — the required figures
                                 * still blank or not a number — so the reader sees *which* cards
                                 * the save is waiting on. The sentence saying why is under the row.
                                 */}
                                <DerivedPanel
                                    testID="kitchen-ingredient-nutrition-grid"
                                    variant="outline"
                                    emptyValue={t('kitchen:sale.marginUnavailable')}
                                    figures={NUTRITION_FIELDS.map((field) => {
                                        const raw = details.nutrition[field.id] ?? '';
                                        return {
                                            key: field.id,
                                            label: t(field.labelKey),
                                            unit: t(field.unitKey),
                                            value: raw === '' ? null : raw,
                                            input: {
                                                testID: `kitchen-ingredient-nutrient-${field.id}-input`,
                                                nativeID: `kitchen-ingredient-nutrient-${field.id}`,
                                                value: raw,
                                                disabled: !editable,
                                                invalid:
                                                    nutritionPartial &&
                                                    field.required &&
                                                    nutrientValueOf(raw) === null,
                                                onChangeText: (next: string) => {
                                                    edit({
                                                        nutrition: {
                                                            ...details.nutrition,
                                                            [field.id]: next,
                                                        },
                                                    });
                                                },
                                            },
                                        };
                                    })}
                                />

                                {/*
                                 * Said once, under the row rather than on each of the seven fields:
                                 * the rule is about the *set*.
                                 */}
                                {!nutritionPartial ? null : (
                                    <Callout
                                        testID="kitchen-ingredient-nutrition-partial"
                                        role="alert"
                                        tone="warning"
                                        title={t('kitchen:nutritionFacts.partialError')}
                                        body={t('kitchen:nutritionFacts.partialHint')}
                                    />
                                )}

                                <Checkbox
                                    testID="kitchen-ingredient-nutrition-estimated"
                                    id="kitchen-ingredient-nutrition-estimated"
                                    label={t('kitchen:nutritionFacts.estimateLabel')}
                                    checked={details.nutritionEstimated}
                                    disabled={!editable}
                                    onChange={(next) => {
                                        edit({ nutritionEstimated: next });
                                    }}
                                />

                                <FormGrid
                                    track="half"
                                    maxColumns={4}
                                    testID="kitchen-ingredient-nutrition-note-grid"
                                >
                                    {/*
                                     * Four half tracks: a 300-character sentence in a 132px box is
                                     * read two words at a time.
                                     */}
                                    <TextInputField
                                        testID="kitchen-ingredient-nutrition-note"
                                        id="kitchen-ingredient-nutrition-note"
                                        span={4}
                                        size="sm"
                                        label={t('kitchen:nutritionFacts.noteLabel')}
                                        placeholder={t('kitchen:nutritionFacts.notePlaceholder')}
                                        maxLength={300}
                                        value={details.nutritionNote}
                                        disabled={!editable}
                                        onChangeText={(next) => {
                                            edit({ nutritionNote: next });
                                        }}
                                    />
                                </FormGrid>
                            </Stack>
                        ) : (
                            <DerivedPanel
                                testID="kitchen-ingredient-nutrition-panel"
                                variant="outline"
                                figures={figures}
                                emptyValue={t('kitchen:sale.marginUnavailable')}
                            />
                        )}
                    </FormSection>
                )}

                {/* ── allergens, read-only per §6.2 (food) ─────────────────────────────────── */}
                {!family.food ? null : (
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-ingredient-allergens"
                        title={t('kitchen:forms.allergensTitle')}
                        aside={
                            <Badge
                                variant="label"
                                testID="kitchen-ingredient-allergens-source"
                                tone="info"
                                label={t('kitchen:composition.fromDatabase')}
                            />
                        }
                    >
                        {allergens.length === 0 ? (
                            // An em dash, not a sentence: "none recorded" and "free of all
                            // fourteen" are different claims, and this panel can state neither.
                            <Text
                                testID="kitchen-ingredient-allergens-none"
                                variant="mono"
                                tone="secondary"
                            >
                                {t('kitchen:list.noValue')}
                            </Text>
                        ) : (
                            <DerivedPanel
                                testID="kitchen-ingredient-composition"
                                figures={[]}
                                emptyValue={t('kitchen:sale.marginUnavailable')}
                                chips={allergens.map((mapping) => {
                                    const code = String(mapping.allergenCode);
                                    const known = classByCode.get(code);
                                    // `contains` and `may_contain` are two different claims and
                                    // never one colour: the tone separates them, and the class
                                    // name carries the rest.
                                    const tone: TagTone =
                                        mapping.containment === 'contains' ? 'danger' : 'warning';

                                    return (
                                        <Tag
                                            key={code}
                                            testID={`kitchen-ingredient-allergen-${code}`}
                                            tone={tone}
                                            label={
                                                known === undefined
                                                    ? code
                                                    : displayName(known.name, locale).value
                                            }
                                        />
                                    );
                                })}
                            />
                        )}
                    </FormSection>
                )}
            </View>

            <Dialog
                testID="kitchen-ingredient-editor-screen-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-ingredient-editor-screen-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-ingredient-editor-screen-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />

            <Dialog
                testID="kitchen-ingredient-editor-screen-conflict-dialog"
                open={concurrency.conflict !== null}
                onClose={concurrency.keepEditing}
                dismissOnBackdrop={false}
                title={t('kitchen:conflict.title')}
                description={t('kitchen:conflict.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-ingredient-editor-screen-conflict-keep"
                            variant="quiet"
                            label={t('kitchen:conflict.keepEditing')}
                            onPress={concurrency.keepEditing}
                        />
                        <Button
                            testID="kitchen-ingredient-editor-screen-conflict-reload"
                            variant="danger"
                            label={t('kitchen:conflict.reload')}
                            onPress={concurrency.reload}
                        />
                    </>
                }
            >
                {concurrency.conflict === null ? null : (
                    <Text
                        testID="kitchen-ingredient-editor-screen-conflict-detail"
                        tone="secondary"
                        variant="caption"
                    >
                        {concurrency.conflict.failure.message}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}
