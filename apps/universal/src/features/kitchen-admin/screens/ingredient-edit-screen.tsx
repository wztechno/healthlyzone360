import type {
    IngredientAssistSuggestion,
    NutritionReferenceCandidate,
    NutritionReferenceSelection,
    AllergenReferenceSelection,
} from '@healthy360/api-client/contracts';
import { NutritionReferencePicker } from '../nutrition-reference-picker.tsx';
import type {
    AllergenClass,
    CostAmount,
    IngredientAdmin,
    IngredientAllergenMapping,
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
    Cascade,
    Checkbox,
    Dialog,
    ErrorState,
    FormGrid,
    FormIssueBanner,
    FormSection,
    FormSkeleton,
    Icon,
    Inline,
    QuantityInput,
    Select,
    Stack,
    Switch,
    Tag,
    TagRow,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { FormIssueItem, SelectOption, TagTone } from '@healthy360/design-system';
import { IngredientId, RecipeId } from '@healthy360/domain-types';
import type { AllergenCode } from '@healthy360/domain-types';
import { isCurrencyCode } from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { coreNutrientDefinition } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useItemLatestPurchasesQuery,
    useProcurementReferenceQuery,
    useStockItemsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import {
    subcategoriesOf,
    topLevelCategories,
    useAllergenClassesQuery,
    useCreateIngredientMutation,
    useForkIngredientMutation,
    useIngredientAssist,
    useIngredientCategoriesQuery,
    useIngredientPageQuery,
    useIngredientQuery,
    useNextReferenceQuery,
    useRecipeQuery,
    useSaveRecordPhotoMutation,
    useSetIngredientAllergensMutation,
    useUpdateIngredientMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { resolveEntityImage } from '../../../media/entity-image.tsx';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { returnCrumbLabel } from '../came-from.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { DerivedPanel } from '../catalogue/derived-panel.tsx';
import type { DerivedFigure } from '../catalogue/derived-panel.tsx';
import { ingredientStockPhotoId } from '../catalogue/ingredient-photo.ts';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import {
    ADMIN_UNITS,
    UNIT_DIMENSIONS,
    adminUnitsWith,
    amountToInput,
    containmentKey,
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
    withoutMinus,
} from '../format.ts';
import { ImageSlot } from '../image-slot.tsx';
import { parseIngredientNeeds } from '../ingredient-fix.ts';
import type { IngredientNeed } from '../ingredient-fix.ts';
import { IngredientAssistPanel } from '../ingredient-assist-panel.tsx';
import { AllergenReferencePicker } from '../allergen-reference-picker.tsx';
import { IngredientAllergenEditor } from '../ingredient-allergen-editor.tsx';
import { IngredientBarcodesSection } from '../ingredient-barcodes-section.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { focusFirstRefusal } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import type { ServerFieldTarget } from '../server-field-errors.ts';
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
 * New food requires a suitable reference and preparation acknowledgement before Save is enabled.
 * Other incomplete fields are explained on pressing Save: the required
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
 * ## Nutrition is read-only — handoff §6.2
 *
 * The per-100 g figures come from the database and only from the database. They were inputs for a
 * while, so a kitchen could copy a supplier's label onto a row it had created; that path is closed.
 * The cards draw what the record holds — an em dash where it holds nothing — and **the save never
 * sends `per100g`**, so a save can neither change the figures nor clear them. That is also why there
 * is no "all seven or none" gate any more: a gate over figures nobody can type could only ever block
 * a record the database stored part-filled, with no way for the reader to clear it.
 *
 * The estimate flag and the source's own sentence stay editable beside the cards. They are a claim
 * *about* the figures, which a kitchen is in a position to make, and the server takes either one on
 * its own.
 *
 * **Except where the figures are a recipe's.** An ingredient a published version *outputs* — a
 * pesto mix — has its facts derived from the formulation that makes it, and the server refuses the
 * flag and the note on it too. That record gets a `Derived from a recipe` badge and no flag or note,
 * and the save sends nothing about nutrition at all.
 *
 * Allergens are the exception, and editable. A recipe cannot publish while one of its ingredients
 * has no determination, so a kitchen that creates an ingredient must be able to record one here —
 * `IngredientAllergenEditor`, one choice per class, saved wholesale through
 * `setIngredientAllergens`. An empty set is confirmed in words and recorded by the server as
 * "assessed, carries nothing". The upgrade-only rule on platform baselines stays the server's. A
 * row this caller cannot write still shows its determination as chips. The quarantine banner
 * stays: an ingredient can still *arrive* in `review_required` from a write made elsewhere.
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
 * The per-100 g figures this form draws, in the order the reference document writes them — the
 * seven the recipe roll-up needs, then saturated fat, which the source table has no column for.
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
}[] = [
    {
        id: 'energy',
        labelKey: 'nutrition:nutrients.energy',
        unitKey: 'kitchen:nutritionFacts.unitKcal',
    },
    {
        id: 'protein',
        labelKey: 'nutrition:nutrients.protein',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'carbohydrate',
        labelKey: 'nutrition:nutrients.carbohydrate',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'fat',
        labelKey: 'nutrition:nutrients.fat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'fibre',
        labelKey: 'nutrition:nutrients.fibre',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'sugars',
        labelKey: 'nutrition:nutrients.sugars',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'sodium',
        labelKey: 'nutrition:nutrients.sodium',
        unitKey: 'kitchen:nutritionFacts.unitMilligrams',
    },
    {
        id: 'saturated_fat',
        labelKey: 'nutrition:nutrients.saturatedFat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
];

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
        // `?? false`: the row's null is "nobody has said", and an unticked box is what that looks
        // like. Saving resolves it, which is the same answer the server reaches on its own.
        nutritionEstimated: ingredient.nutritionEstimated ?? false,
        nutritionNote: ingredient.nutritionNote ?? '',
    };
}

/**
 * Packaging's three: **pack price, waste, holds** — `purchasePrice`, `wastePercent` and
 * `capacity` on `IngredientAdmin`.
 *
 * Drawn and editable for a long time while nothing sent them, so a save threw all three away
 * (HA-30). They are written now, on create and on edit, and only for packaging: food never draws
 * them, so a food save leaves the columns alone. Editing one marks the record dirty like any field.
 */
interface PackagingDraft {
    readonly packPrice: string;
    readonly wastePercent: string;
    readonly capacity: string;
    readonly capacityUnit: MeasureUnit;
}

const EMPTY_PACKAGING: PackagingDraft = {
    packPrice: '',
    wastePercent: '',
    capacity: '',
    capacityUnit: 'l',
};

function packagingFrom(ingredient: IngredientAdmin): PackagingDraft {
    return {
        packPrice: amountToInput(ingredient.purchasePrice),
        wastePercent: ingredient.wastePercent === null ? '' : String(ingredient.wastePercent),
        capacity: ingredient.capacity === null ? '' : String(ingredient.capacity.quantity),
        capacityUnit: ingredient.capacity?.unit ?? 'l',
    };
}

/**
 * Above this, a packaging loss is flagged — the design's `Above 10%`. A warning and not a refusal:
 * a film that tears on the sealer really can lose a fifth, and saying so is the record doing its job.
 */
const WASTE_WARNING_PERCENT = 10;

/**
 * Where a recipe's "fix allergens / nutrition" lands: the line at the top of that section saying
 * what to do. The two have no single field — a determination is fourteen choices, a reference is a
 * search — so the reader is taken to the section, and the line is what they read first.
 */
const NEED_TARGET = {
    allergens: 'kitchen-ingredient-need-allergens',
    nutrition: 'kitchen-ingredient-need-nutrition',
} as const;

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
 * The eight tiles the nutrition section draws, from the record — in the order of the table above.
 *
 * A figure the record has not got comes back `null` and the panel draws an em dash in its place.
 * The row does not collapse to a sentence: see `DerivedPanel` for why an absent figure is still a
 * tile, and why it is never a zero. The unit is the bare unit — `kcal`, `g` — because the section
 * title already says `· 100 g`, and repeating the basis on eight tiles is eight times the same
 * words.
 */
function nutrientFigures(
    amounts: readonly { readonly nutrientId: string; readonly value: number }[] | null,
    t: TFunction,
    formatter: Formatter,
): readonly DerivedFigure[] {
    return NUTRITION_FIELDS.flatMap((field) => {
        const definition = coreNutrientDefinition(field.id);
        if (definition === null) return [];

        const amount = amounts?.find((entry) => entry.nutrientId === field.id) ?? null;

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
     * Drives the Id preview only. The number the record actually takes is the server's, which picks
     * the series from the category — a row filed under packaging joins `PKG-`, anything else `ING-`
     * — so this has to name the same series for the preview to match the saved handle.
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

export const INGREDIENT_FAMILY: IngredientEditFamily = {
    series: 'ING-',
    listRoute: '/kitchen/ingredients',
    categoryCode: '',
    createTitleKey: 'kitchen:editor.createTitle',
    food: true,
};

export const PACKAGING_FAMILY: IngredientEditFamily = {
    series: 'PKG-',
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
    /**
     * `?returnTo=` — the page that sent the reader here to fix something, as written: a recipe, on
     * the tab its raw material is on. Cancel and a successful Save go back to it.
     */
    readonly returnTo?: string | undefined;
    /** `?needs=` — what that page needs fixed here (`ingredient-fix.ts`), as the route reads it. */
    readonly needs?: string | undefined;
}

export function IngredientEditScreen({
    ingredient,
    family,
    returnTo,
    needs,
}: IngredientEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredient-editor"
        >
            <IngredientEditor
                ingredient={ingredient}
                family={family}
                returnTo={returnTo}
                needs={needs}
            />
        </Gate>
    );
}

function IngredientEditor({
    ingredient,
    family = INGREDIENT_FAMILY,
    returnTo,
    needs: neededRaw,
}: IngredientEditScreenProps) {
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
    const photoSave = useSaveRecordPhotoMutation();
    const allergenSave = useSetIngredientAllergensMutation();
    /*
     * "This ingredient has no allergens", ticked on the new-ingredient form. The empty set needs the
     * record's id and version, so it is written right after the record is created — the same write
     * as the edit page's "Confirm no allergens". A chosen allergen suggestion says otherwise, so
     * the box goes while one is chosen and counts only without one.
     */
    const [noAllergens, setNoAllergens] = useState(false);

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    /*
     * Cancel and the not-found page's way out go back a step, the way the browser's arrow does —
     * to the list as it was left, its filter and page included — and only fall back to opening the
     * list afresh when there is nothing behind this page (a deep link, a refresh). Sent here from a
     * recipe to fix something, they go back to that recipe instead, and so does a successful Save.
     */
    const back = useReturnTo(returnTo, family.listRoute);
    const needs = useMemo(() => parseIngredientNeeds(neededRaw), [neededRaw]);
    /*
     * The recipe a fix was sent from, by name, so the way back says where it goes. Read from the
     * cache the recipe page filled; a member who may not read recipes gets the plain label.
     */
    const returnRecipeId = useMemo(() => {
        const match = /^\/kitchen\/recipes\/([^/?#]+)/.exec(back.returnTo ?? '');
        return match === null ? null : RecipeId.safeParse(match[1]);
    }, [back.returnTo]);
    const returnRecipe = useRecipeQuery(returnRecipeId);
    const returnName =
        returnRecipe.data === undefined ? null : displayName(returnRecipe.data.name, locale).value;
    const returnLabel = useMemo(
        () => returnCrumbLabel(back.returnTo, t, returnName),
        [back.returnTo, t, returnName],
    );

    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);
    const [packaging, setPackaging] = useState<PackagingDraft>(EMPTY_PACKAGING);
    /*
     * The photo slot, whether its stock picture is off, the record state they were last filled from
     * (`undefined` until the record arrives), and whether they have been changed since. Rehydrated
     * on their own key rather than the lock version: the photo endpoint moves the link and not the
     * version, and a slot reset by the record's own save answer would flash the old photo until the
     * re-read arrives.
     */
    const [photo, setPhoto] = useState<string | null>(null);
    const [stockHidden, setStockHidden] = useState(false);
    const [photoKey, setPhotoKey] = useState<string | undefined>(undefined);
    const [photoDirty, setPhotoDirty] = useState(false);

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
            : {
                  ...EMPTY_DETAILS,
                  categoryCode: family.categoryCode,
                  // Grams is not on the packaging list; a counted item is the common case.
                  ...(family.food ? {} : { measurementUnit: 'piece' }),
              },
    );
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);
    const [referenceDraft, setReferenceDraft] = useState<{
        readonly name: string;
        readonly selection: NutritionReferenceSelection | undefined;
        /** The record behind `selection`, so the picker can draw it after a rename. */
        readonly candidate?: NutritionReferenceCandidate | undefined;
    }>({ name: '', selection: undefined });
    const [allergenDraft, setAllergenDraft] = useState<{
        readonly name: string;
        readonly selection: AllergenReferenceSelection | undefined;
    }>({ name: '', selection: undefined });
    const allergenReference =
        allergenDraft.name === details.name.en ? allergenDraft.selection : undefined;
    const nutritionReference =
        referenceDraft.name === details.name.en ? referenceDraft.selection : undefined;

    /*
     * The ingredient assistant (new food records only), run when the English name loses focus.
     *
     * Only the latest request may apply — a sequence number, because two reruns for the same name
     * can resolve out of order and comparing names cannot tell them apart. Even the latest applies
     * a field only while that field is still the assistant's to fill: Arabic into an empty box,
     * the category pair into an empty pair, a nutrition match where none is chosen. Nothing the
     * cook typed or picked is ever replaced.
     */
    const assist = useIngredientAssist();
    const assistSequence = useRef(0);
    const assistedName = useRef<string | null>(null);
    /** Set by "Update ingredient name": the next rename carries the nutrition choice, unconfirmed. */
    const keepReferenceOnRename = useRef(false);
    const latestDetails = useRef(details);
    useEffect(() => {
        latestDetails.current = details;
    });
    const [assisted, setAssisted] = useState<{
        readonly name: string;
        readonly result: IngredientAssistSuggestion;
    } | null>(null);
    /** What the assistant wrote into the Arabic box; the badge holds while the box still says it. */
    const [arabicFromAi, setArabicFromAi] = useState<string | null>(null);
    /**
     * What the assistant last wrote, read at response time. A field still holding exactly that is
     * the assistant's own answer for an earlier name, not the cook's, so the next answer replaces
     * it — otherwise a rename from Cilantro to Chickpeas kept "كزبرة" and the herb category.
     */
    const aiFilled = useRef<{
        arabic: string | null;
        pair: { readonly categoryCode: string; readonly subcategoryCode: string } | null;
        unit: MeasureUnit | null;
        grams: string | null;
    }>({ arabic: null, pair: null, unit: null, grams: null });
    /** The unit and the mass of one litre or piece the assistant wrote; markers hold while unchanged. */
    const [unitFromAi, setUnitFromAi] = useState<MeasureUnit | null>(null);
    const [gramsFromAi, setGramsFromAi] = useState<string | null>(null);
    /**
     * The cook's confirmation of the allergens the assistant indicated, for the name it was given.
     * Only shown when no Open Food Facts product is chosen; confirmed, it is written as the kitchen's
     * own declaration after the record is created.
     */
    const [aiAllergensConfirmedFor, setAiAllergensConfirmedFor] = useState<string | null>(null);
    const assistForName =
        assisted !== null && assisted.name === details.name.en.trim() ? assisted.result : undefined;
    /** The assistant's allergen read for this name; empty when it found none or did not answer. */
    const aiAllergenCodes = assistForName?.allergens.codes ?? [];
    const aiAllergensConfirmed =
        aiAllergenCodes.length > 0 && aiAllergensConfirmedFor === details.name.en.trim();
    const allergenClassName = (code: AllergenCode): string => {
        const known = classes.data?.find((entry) => entry.code === code);
        return known === undefined ? String(code) : displayName(known.name, locale).value;
    };
    const isPackaging = details.categoryCode.startsWith('packaging-disposables');
    const referenceRequired =
        !isPackaging &&
        (isCreating || (record.data?.categoryCode.startsWith('packaging-disposables') ?? false));
    const referenceBlocked =
        (referenceRequired && nutritionReference === undefined) ||
        (nutritionReference !== undefined && !nutritionReference.confirmed) ||
        (isCreating &&
            !isPackaging &&
            allergenReference !== undefined &&
            !allergenReference.confirmed);

    const data = record.data;

    /*
     * The unit price shown on this screen is what the kitchen last paid a supplier — the same
     * figure the Stock page's "Last purchase" column reads — and it is shown, never typed. A receipt
     * moves it; this screen does not. The stock item is the link: a purchase is recorded against
     * the shelf, and the shelf names the ingredient it holds.
     */
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);
    const stockItems = useStockItemsQuery(family.food && !isCreating && canViewCosts);
    const stockItemId = useMemo(() => {
        if (parsed === null) return null;
        const shelf = stockItems.data?.find(
            (item) => item.ingredientId !== null && String(item.ingredientId) === String(parsed),
        );
        return shelf === undefined ? null : shelf.id;
    }, [stockItems.data, parsed]);
    const latestPurchaseIds = useMemo(
        () => (stockItemId === null ? [] : [stockItemId]),
        [stockItemId],
    );
    const latestPurchases = useItemLatestPurchasesQuery(latestPurchaseIds, canViewCosts);
    const latestPurchase = latestPurchases.data?.[0] ?? null;

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
        setPackaging(packagingFrom(data));
    }
    const savedPhotoKey =
        data === undefined ? undefined : `${data.photoUrl ?? ''}|${String(data.stockPhotoHidden)}`;
    if (data !== undefined && savedPhotoKey !== photoKey && !photoDirty) {
        setPhotoKey(savedPhotoKey);
        setPhoto(data.photoUrl ?? null);
        setStockHidden(data.stockPhotoHidden ?? false);
    }

    /*
     * The stock picture the list draws for this row when it has no upload: the slot shows it too,
     * so the reader sees the picture the row really has — and can replace it or take it off. A copy
     * of a platform row keeps its parent's slug and so its picture, whatever it is renamed to; this
     * is how a renamed copy of Peach showed a peach nobody chose. A new record has no slug yet.
     */
    const stockPhotoOf = (hidden: boolean) =>
        data === undefined
            ? null
            : resolveEntityImage(
                  ingredientStockPhotoId({ slug: data.slug, stockPhotoHidden: hidden }),
                  'card',
              );
    const stockPhoto = stockPhotoOf(stockHidden);
    const hasStockPhoto = stockPhotoOf(false) !== null;
    const savedStockHidden = data?.stockPhotoHidden ?? false;

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
    // Sent from a recipe, the crumb above is that recipe, by name, and takes the reader back to it.
    useKitchenTrailLeaf(
        isCreating || data !== undefined ? title : null,
        back.returnTo === null
            ? undefined
            : () => {
                  guard.intercept(back.leave);
              },
        returnLabel ?? undefined,
    );

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    /*
     * The allergen set has its own Save, and the record's save remounts its editor — so unsaved
     * allergen choices were dropped by the main Save and by leaving the page (HA-39). They now hold
     * the unsaved guard, and the main Save sends the reader to "Save allergens" first.
     */
    const [allergensDirty, setAllergensDirty] = useState(false);
    const allergensWereDirty = useRef(false);
    useEffect(() => {
        // Clean only on the allergens' own true → false, and only when nothing else is unsaved.
        if (allergensDirty) guard.markDirty();
        else if (allergensWereDirty.current && !detailsDirty && !photoDirty) guard.markClean();
        allergensWereDirty.current = allergensDirty;
    }, [allergensDirty, detailsDirty, photoDirty, guard]);

    const settle = (nextDirty: boolean) => {
        setDetailsDirty(nextDirty);
        if (!nextDirty) {
            guard.markClean();
            setReferenceDraft({ name: '', selection: undefined });
            setAllergenDraft({ name: '', selection: undefined });
        }
    };

    const reload = useCallback(() => {
        setReferenceDraft({ name: '', selection: undefined });
        setAllergenDraft({ name: '', selection: undefined });
        setDetailsDirty(false);
        setDetailsKey(null);
        setPhotoDirty(false);
        setPhotoKey(undefined);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── what a recipe sent the reader here to fix ───────────────────────────────────────────── */

    /*
     * Each thing `?needs=` asks for, as this page answers it: the section it is in, the element to
     * take the reader to, what to do in one short line, and whether the saved record has done it
     * yet — read from the record, so the list ticks itself off as each save lands. Allergens and
     * nutrition are food's alone; a box is only ever asked about its unit or its price.
     */
    const savedAllergens = data?.allergens ?? [];
    const needItems: readonly {
        readonly key: IngredientNeed;
        readonly section: string;
        readonly message: string;
        readonly targetId: string;
        readonly resolved: boolean;
    }[] = needs
        .filter((need) => family.food || need === 'unit' || need === 'price')
        .map((need) => {
            switch (need) {
                case 'allergens':
                    return {
                        key: need,
                        section: t('kitchen:forms.allergensTitle'),
                        message: t('kitchen:ingredientFix.allergens'),
                        targetId: NEED_TARGET.allergens,
                        resolved:
                            data !== undefined &&
                            !quarantined &&
                            !allergensDirty &&
                            (savedAllergens.length > 0 || data.allergensAssessedClear === true),
                    };
                case 'nutrition':
                    return {
                        key: need,
                        section: t('kitchen:forms.nutritionTitle'),
                        message: t('kitchen:ingredientFix.nutrition'),
                        targetId: NEED_TARGET.nutrition,
                        resolved:
                            data !== undefined &&
                            data.pendingNutrition == null &&
                            data.per100g != null,
                    };
                case 'unit':
                    return {
                        key: need,
                        section: t(
                            family.food
                                ? 'kitchen:editor.sectionMeasurement'
                                : 'kitchen:forms.pack',
                        ),
                        message: t('kitchen:ingredientFix.unit', {
                            unit: t(unitShortKey(details.measurementUnit)),
                        }),
                        targetId:
                            unitDimension(details.measurementUnit) === 'mass'
                                ? 'kitchen-ingredient-unit'
                                : 'kitchen-ingredient-grams-per-unit',
                        resolved:
                            data !== undefined &&
                            (unitDimension(data.measurementUnit) === 'mass' ||
                                data.gramsPerUnit !== null),
                    };
                case 'price':
                    return family.food
                        ? {
                              key: need,
                              section: t('kitchen:editor.sectionMeasurement'),
                              message: t('kitchen:ingredientFix.priceFood'),
                              targetId: 'kitchen-ingredient-unit-price',
                              resolved:
                                  data !== undefined &&
                                  (data.purchasePrice !== null ||
                                      data.costPer100g !== null ||
                                      (latestPurchase?.unitPriceAmount ?? null) !== null),
                          }
                        : {
                              key: need,
                              section: t('kitchen:forms.cost'),
                              message: t('kitchen:ingredientFix.pricePack'),
                              targetId: 'kitchen-ingredient-pack-price',
                              resolved: data?.purchasePrice != null,
                          };
            }
        });
    const openNeed = (key: IngredientNeed) =>
        needItems.find((item) => item.key === key && !item.resolved);
    const needsDone = needItems.length > 0 && needItems.every((item) => item.resolved);

    /*
     * Back to the recipe once a save has done what it was sent here for — by this page's Save, or
     * by the moment the last thing asked for is done (allergens have a Save of their own, and a
     * reader who has just pressed it should not have to find a second button). Once: a ref, so the
     * re-read that follows a save never sends the reader back twice.
     */
    const returned = useRef(false);
    const goBackToRecipe = useCallback(() => {
        if (returned.current) return;
        returned.current = true;
        toast.show({
            testID: 'kitchen-ingredient-saved-toast',
            tone: 'success',
            message:
                returnName === null
                    ? t('kitchen:ingredientFix.savedBack')
                    : t('kitchen:ingredientFix.savedBackNamed', { name: returnName }),
        });
        back.finish();
    }, [back, returnName, t, toast]);
    const wasDone = useRef(needsDone);
    useEffect(() => {
        const became = needsDone && !wasDone.current;
        wasDone.current = needsDone;
        if (became && back.returnTo !== null && !guard.isDirty) goBackToRecipe();
    }, [needsDone, back.returnTo, guard.isDirty, goBackToRecipe]);

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
     * ## Kg, L or Pc — the admin's three
     *
     * Food and packaging alike are stocked and bought in kilograms, litres or pieces: the owner's
     * list, shared by every unit picker in the admin (`ADMIN_UNITS`). A litre or a piece of food is
     * weighed through "what one unit weighs", which this form asks for whenever the unit is not a
     * mass, so a recipe naming it can still be labelled. A record saved before, in a pack or a bag,
     * keeps its own unit on the list (`savedUnitOptions`), so opening it never shows a placeholder
     * over a value that is set.
     *
     * `slice` and `portion` are gone from both. They have no `measurement_units` row, so
     * `MeasurementUnitLookup` could not resolve either and the write layer dropped the field
     * without a word — picking "Slices" saved nothing and reported success. They stay in
     * `MEASURE_UNITS` because they are the *serving* vocabulary the marketplace uses; they were
     * never stock units.
     */
    const unitOptions: readonly SelectOption[] = useMemo(() => {
        return UNIT_DIMENSIONS.flatMap((dimension) =>
            ADMIN_UNITS.filter((unit) => unitDimension(unit) === dimension).map((unit) => ({
                value: unit,
                label: t(unitKey(unit)),
                description: t(unitDimensionKey(dimension)),
            })),
        );
    }, [t]);

    const savedUnitOptions = (saved: MeasureUnit | null | undefined): readonly SelectOption[] =>
        saved === null ||
        saved === undefined ||
        unitOptions.some((option) => option.value === saved)
            ? unitOptions
            : [
                  ...unitOptions,
                  {
                      value: saved,
                      label: t(unitKey(saved)),
                      description: t(unitDimensionKey(unitDimension(saved))),
                  },
              ];

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
     * The record's own money first, because a priced ingredient has already answered the question;
     * then whatever the rest of the catalogue is priced in, by frequency; then the organisation's
     * default currency from the procurement reference — without it, a kitchen that had priced
     * nothing yet could never save its first pack price (HA-30). `null` only when none of the
     * three answers, and the price fields say so rather than guessing a country's money.
     */
    const canReadReference = useCan(INVENTORY_VIEW_PERMISSION);
    const procurementReference = useProcurementReferenceQuery(canReadReference);
    const defaultCurrency = procurementReference.data?.defaultCurrencyCode;
    const currency = useMemo<CurrencyCode | null>(() => {
        const own = [
            data?.unitPrice,
            data?.b2bPrice,
            data?.b2cPrice,
            data?.costPer100g,
            data?.purchasePrice,
        ];
        for (const cost of own) {
            if (cost !== null && cost !== undefined) return cost.currency;
        }

        const counts = new Map<CurrencyCode, number>();
        for (const row of catalogue.data?.items ?? []) {
            for (const cost of [
                row.unitPrice,
                row.b2bPrice,
                row.b2cPrice,
                row.costPer100g,
                row.purchasePrice,
            ]) {
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
        return best ?? (isCurrencyCode(defaultCurrency) ? defaultCurrency : null);
    }, [data, catalogue.data, defaultCurrency]);

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
     *
     * Sent here from a recipe, the copy keeps the fix and the way back — and the way back carries
     * `swapFrom` / `swapTo`, because the server leaves existing recipes on the library row: the
     * recipe swaps its line to this kitchen's copy when the reader returns, or the fix made here
     * would never reach it.
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
                router.replace(
                    withReturnTo(
                        withQuery(`${family.listRoute}/${String(created.id)}`, {
                            needs: needs.length === 0 ? null : needs.join(','),
                        }),
                        back.returnTo === null
                            ? null
                            : withQuery(back.returnTo, {
                                  swapFrom: String(data.id),
                                  swapTo: String(created.id),
                              }),
                    ) as never,
                );
            },
        });
    };

    /*
     * Opening a library row to edit it *is* asking for the kitchen's copy, so the fork fires on
     * arrival instead of waiting behind the notice's button. The page holds its skeleton meanwhile —
     * a read-only form flashed on the way to an editable one reads as a refusal. The notice is left
     * for a fork that failed, where its button is the retry, and for a reader who cannot fork.
     *
     * Once per row, not per render: the ref keeps StrictMode's second effect and every re-render from
     * posting again, and a failure is retried by the button rather than by a loop.
     */
    const autoFork = platformNotice && canManage && !fork.isError;
    const forkedRow = useRef<IngredientId | null>(null);
    useEffect(() => {
        if (!autoFork || data === undefined || forkedRow.current === data.id) return;
        forkedRow.current = data.id;
        forkForKitchen();
    });

    const nameMissing = details.name.en.trim() === '';
    const categoryMissing = details.categoryCode.trim() === '';

    const unitPriceValue = parseAmount(details.unitPrice);
    const b2bPriceValue = parseAmount(details.b2bPrice);
    const b2cPriceValue = parseAmount(details.b2cPrice);
    const packPriceValue = family.food ? null : parseAmount(packaging.packPrice);

    // A price cannot be written without a currency to write it in, so an amount typed with no
    // currency resolved is a blocked save rather than a guess.
    const currencyMissing =
        currency === null &&
        [unitPriceValue, b2bPriceValue, b2cPriceValue, packPriceValue].some(
            (value) => typeof value === 'number',
        );

    // Only non-derived food can select a reference. Figures and provenance remain server-managed.
    const nutritionDerived = data?.nutritionDerivedFromVersionId ?? null;
    const nutritionEditable = family.food && nutritionDerived === null;

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
        // The allergen set is saved by its own button; the record save would discard it (HA-39).
        ...(allergensDirty
            ? [
                  {
                      key: 'allergens',
                      label: t('kitchen:allergens.save'),
                      fieldId: 'kitchen-ingredient-mapping-grid',
                      required: false,
                  },
              ]
            : []),
        // Now that the pack price is saved, a typo in it must stop the save rather than clear it.
        ...(packPriceValue === undefined
            ? [
                  {
                      key: 'pack-price',
                      label: t('kitchen:packaging.columnPackPrice'),
                      fieldId: 'kitchen-ingredient-pack-price',
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
     * Packaging's one caution: a loss above a tenth is unusual enough to say so. Never blocks: a
     * film that tears on the sealer really can lose a fifth.
     */
    const wasteHigh =
        !family.food && (parseQuantity(packaging.wastePercent) ?? 0) > WASTE_WARNING_PERCENT;

    const blockerItems: readonly FormIssueItem[] = shownBlockers.map((entry) => ({
        key: entry.key,
        label: entry.label,
        // The chip names the field; the field still says what is wrong under itself.
        fieldId: entry.fieldId,
        onPress: () => {
            focusField(entry.fieldId);
        },
    }));
    const warningItems: readonly FormIssueItem[] = wasteHigh
        ? [
              {
                  key: 'waste',
                  label: t('kitchen:forms.waste'),
                  fieldId: 'kitchen-ingredient-waste',
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

    /** Packaging's three as a request takes them, `null` clearing one. Food sends none of them. */
    const packPrice = costOf(packPriceValue);
    const wastePercent = parseQuantity(packaging.wastePercent);
    const capacityQuantity = positiveNumberOf(packaging.capacity);
    const capacity =
        capacityQuantity === null
            ? null
            : { quantity: capacityQuantity, unit: packaging.capacityUnit };
    const packagingWrite = family.food ? {} : { purchasePrice: packPrice, wastePercent, capacity };
    /** The same, for a create, which has nothing to clear. */
    const packagingCreate = family.food
        ? {}
        : {
              ...(packPrice === null ? {} : { purchasePrice: packPrice }),
              ...(wastePercent === null ? {} : { wastePercent }),
              ...(capacity === null ? {} : { capacity }),
          };

    /**
     * The photo, written once the record's own save has answered: it needs the record's id, and a
     * refused upload must not undo a record that is already saved. Answers the failure, or null.
     * An untouched slot is a no-op, so every save calls it.
     */
    const writePhoto = async (
        ingredientId: IngredientId,
        saved: string | null | undefined,
    ): Promise<unknown> => {
        try {
            await photoSave.mutateAsync({
                subject: 'ingredient',
                recordId: String(ingredientId),
                chosen: photo,
                saved,
                clearsStock: hasStockPhoto && stockHidden && !savedStockHidden,
            });
            setPhotoDirty(false);
            return null;
        } catch (error) {
            return error;
        }
    };

    /**
     * The allergens declared on the new-ingredient form, written against the record just created:
     * the assistant's read once the cook confirmed it, or the ticked "no allergens" box. A chosen
     * Open Food Facts product is imported by the create itself. Answers the failure, or null.
     */
    const confirmNoAllergens = async (created: IngredientAdmin): Promise<unknown> => {
        if (allergenReference !== undefined || isPackaging) return null;
        const mappings: IngredientAllergenMapping[] | null = aiAllergensConfirmed
            ? aiAllergenCodes.map((entry) => ({
                  allergenCode: entry.allergenCode,
                  containment: entry.containment,
                  marketScope: [],
                  verification: 'operator_confirmed',
                  sourceNote: t('kitchen:assist.allergenSourceNote'),
              }))
            : noAllergens
              ? []
              : null;
        if (mappings === null) return null;
        try {
            await allergenSave.mutateAsync({
                ingredientId: created.id,
                request: { lockVersion: created.meta.lockVersion, mappings },
            });
            return null;
        } catch (error) {
            return error;
        }
    };

    /*
     * What the server can refuse, by its field name, and where that field is on this page — in the
     * order the page draws them, so a refused save takes the reader to the first one (BUG-06).
     */
    const serverTargets: Readonly<Record<string, ServerFieldTarget>> = {
        name_en: {
            label: t('kitchen:bilingual.englishShort', { field: t('kitchen:list.columnItem') }),
            fieldId: 'kitchen-ingredient-name-en',
        },
        name_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: t('kitchen:list.columnItem') }),
            fieldId: 'kitchen-ingredient-name-ar',
        },
        ingredient_category_id: {
            label: t('kitchen:fields.category'),
            fieldId: 'kitchen-ingredient-category',
        },
        ingredient_subcategory_id: {
            label: t('kitchen:fields.subcategory'),
            fieldId: 'kitchen-ingredient-subcategory',
        },
        purchase_unit_id: {
            label: t('kitchen:fields.purchaseUnit'),
            fieldId: 'kitchen-ingredient-purchase-unit',
        },
        default_unit_id: {
            label: t(family.food ? 'kitchen:fields.stockUnit' : 'kitchen:forms.issueUnit'),
            fieldId: 'kitchen-ingredient-unit',
        },
        capacity_quantity: {
            label: t('kitchen:forms.holds'),
            fieldId: 'kitchen-ingredient-capacity',
        },
        purchase_price_amount: {
            label: t('kitchen:packaging.columnPackPrice'),
            fieldId: 'kitchen-ingredient-pack-price',
        },
        waste_percent: {
            label: t('kitchen:forms.waste'),
            fieldId: 'kitchen-ingredient-waste',
        },
        b2b_price_amount: {
            label: t('kitchen:sale.b2bPrice'),
            fieldId: 'kitchen-ingredient-b2b-price',
        },
        b2c_price_amount: {
            label: t('kitchen:sale.b2cPrice'),
            fieldId: 'kitchen-ingredient-b2c-price',
        },
    };

    const showSaved = () => {
        // Sent here from a recipe: the save is the end of the detour, so it goes straight back.
        if (back.returnTo !== null) {
            goBackToRecipe();
            return;
        }
        toast.show({
            testID: 'kitchen-ingredient-saved-toast',
            tone: 'success',
            message: t('kitchen:editor.savedToast'),
        });
    };

    const save = () => {
        if (!editable || currencyMissing) return;
        setAttempted(true);
        if (referenceBlocked) return;
        if (blockers.length > 0) {
            // The banner names every field; the first one is also where the reader is taken.
            focusField(blockers[0]!.fieldId);
            return;
        }

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
                    ...packagingCreate,
                    ...(allergenReference === undefined || isPackaging
                        ? {}
                        : { allergenReference }),
                    ...(nutritionReference === undefined ? {} : { nutritionReference }),
                    isSellable: details.isSellable,
                },
                {
                    onSuccess: (created) => {
                        void (async () => {
                            const photoError = await writePhoto(created.id, null);
                            const allergenError = await confirmNoAllergens(created);
                            settle(false);
                            toast.show({
                                testID: 'kitchen-ingredient-created-toast',
                                tone: 'success',
                                message: t('kitchen:editor.createdToast', {
                                    name: displayName(created.name, locale).value,
                                }),
                            });
                            // The page is about to leave, so a refused photo is said in a toast
                            // rather than the callout, which would go with it.
                            if (photoError !== null) {
                                toast.show({
                                    tone: 'danger',
                                    message:
                                        toFailure(photoError)?.message ??
                                        t('kitchen:editor.saveError'),
                                });
                                photoSave.reset();
                            }
                            if (allergenError !== null) {
                                toast.show({
                                    tone: 'danger',
                                    message:
                                        toFailure(allergenError)?.message ??
                                        t('kitchen:allergens.saveError'),
                                });
                            }
                            router.replace(`${family.listRoute}/${String(created.id)}` as never);
                        })();
                    },
                    onError: (error) => {
                        focusFirstRefusal(error, serverTargets);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        const savedPhoto = data.photoUrl;

        /*
         * Only the photo changed: the record write would be an audited act that changed nothing.
         * A refused photo leaves the slot dirty, with the callout below saying why.
         */
        if (!detailsDirty && photoDirty) {
            void writePhoto(data.id, savedPhoto).then((photoError) => {
                if (photoError === null) {
                    settle(false);
                    showSaved();
                }
            });
            return;
        }
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
                    // Not on a recipe-derived row: the server refuses any mass there, so sending
                    // it — even null — refused the whole save (HA-38).
                    ...(nutritionDerived === null
                        ? { gramsPerUnit: positiveNumberOf(details.gramsPerUnit) }
                        : {}),
                    unitPrice: costOf(unitPriceValue),
                    b2bPrice: costOf(b2bPriceValue),
                    b2cPrice: costOf(b2cPriceValue),
                    ...packagingWrite,
                    // Submit the reviewed reference; the server owns figures and provenance.
                    ...(nutritionReference === undefined ? {} : { nutritionReference }),
                    isSellable: details.isSellable,
                },
            },
            {
                onSuccess: () => {
                    void writePhoto(data.id, savedPhoto).then((photoError) => {
                        settle(false);
                        if (photoError === null) {
                            showSaved();
                            return;
                        }
                        // The record is saved; only the photo is left to try again.
                        guard.markDirty();
                    });
                },
                onError: (error) => {
                    if (!concurrency.capture(error)) focusFirstRefusal(error, serverTargets);
                },
            },
        );
    };

    const goBack = () => {
        back.leave();
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

    if (!isCreating && (record.isPending || autoFork)) {
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

    const forkFailure = toFailure(fork.error);

    const saveFailure = toFailure(update.error ?? create.error);
    // What the server refused, put on the fields it named (BUG-06).
    const server = serverFieldErrors(saveFailure, serverTargets);
    // The chosen match's figures until the save returns the record's own — otherwise the cards
    // would sit empty (or show the old reference) while a selection is pending.
    const preview =
        nutritionReference === undefined ? undefined : referenceDraft.candidate?.nutrition_per_100g;
    const figures = nutrientFigures(
        preview?.amounts.map((amount) => ({
            nutrientId: amount.nutrient_id,
            value: amount.value,
        })) ??
            data?.per100g?.amounts ??
            null,
        t,
        formatter,
    );

    // Creating, the reference is the one the save is about to assign rather than one the record
    // carries. Empty while the read is in flight, and empty if it fails: better a blank than a
    // number nothing stands behind.
    const reference = isCreating ? (nextReference.data ?? '') : details.reference.trim();

    const photoFailure = toFailure(photoSave.error);

    const busy = create.isPending || update.isPending || photoSave.isPending;
    const priceUnit = currency === null ? {} : { unit: currency };

    /*
     * The read-only unit price: the last purchase's amount when there is one, otherwise a word in
     * the placeholder for why there is none — still loading, nothing bought yet, or a figure this
     * member may not see. Never a zero: an unbought ingredient and a free one are different facts.
     */
    const currentPriceValue =
        latestPurchase === null || latestPurchase.unitPriceAmount === null
            ? ''
            : formatter.formatNumber(Number(latestPurchase.unitPriceAmount), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              });
    const currentPricePlaceholder = !canViewCosts
        ? t('kitchen:ops.stock.lastPurchaseHidden')
        : stockItems.isPending || latestPurchases.isPending
          ? isCreating || stockItemId === null
              ? t('kitchen:ops.stock.neverBought')
              : t('kitchen:ops.stock.lastPurchaseLoading')
          : t('kitchen:ops.stock.neverBought');
    const currentPriceSource =
        latestPurchase === null
            ? undefined
            : latestPurchase.receivedAt === null
              ? latestPurchase.supplier === null
                  ? t('kitchen:ops.stock.noPurchaseSupplier')
                  : latestPurchase.supplier.nameEn
              : t('kitchen:ops.stock.lastPurchaseFrom', {
                    supplier:
                        latestPurchase.supplier === null
                            ? t('kitchen:ops.stock.noPurchaseSupplier')
                            : latestPurchase.supplier.nameEn,
                    date: formatter.formatDate(latestPurchase.receivedAt, { dateStyle: 'medium' }),
                });

    /** One field of the draft, and the dirty flag with it — the shape every input below writes. */
    const edit = (patch: Partial<DetailsDraft>) => {
        if (patch.name !== undefined && patch.name.en !== details.name.en) {
            const carried =
                keepReferenceOnRename.current && referenceDraft.name === details.name.en
                    ? referenceDraft.selection
                    : undefined;
            setReferenceDraft(
                carried === undefined
                    ? { name: patch.name.en, selection: undefined }
                    : {
                          name: patch.name.en,
                          selection: { ...carried, confirmed: false },
                          candidate: referenceDraft.candidate,
                      },
            );
        }

        setDetails({ ...details, ...patch });
        markDetailsDirty();
    };

    const applyAssist = (name: string, result: IngredientAssistSuggestion) => {
        const current = latestDetails.current;
        if (current.name.en.trim() !== name) return;
        setAssisted({ name, result });

        const { arabic: lastArabic, pair: lastPair } = aiFilled.current;
        const arabicIsAi = lastArabic !== null && current.name.ar === lastArabic;
        const pairIsAi =
            lastPair !== null &&
            current.categoryCode === lastPair.categoryCode &&
            current.subcategoryCode === lastPair.subcategoryCode;
        // Into an empty box, or over the assistant's own earlier answer — which a newer answer
        // replaces even with nothing, since a translation of the old name is wrong for this one.
        const fillArabic = arabicIsAi || (result.nameAr !== null && current.name.ar.trim() === '');
        const pairEmpty = current.categoryCode === '' && current.subcategoryCode === '';
        const fillPair =
            family.categoryCode === '' && (pairIsAi || (result.categoryCode !== null && pairEmpty));
        const fillLeaf =
            !fillPair &&
            family.categoryCode === '' &&
            result.subcategoryCode !== null &&
            current.categoryCode === result.categoryCode &&
            current.subcategoryCode === '';
        /*
         * The unit pair (purchase and stock, set together) and the mass of one litre or piece:
         * untouched or still the assistant's own, the same rule as the Arabic. Food only — packaging
         * buys by the pack and stocks by the piece on purpose.
         */
        const { unit: lastUnit, grams: lastGrams } = aiFilled.current;
        const unitUntouched =
            current.purchaseUnit === '' &&
            current.measurementUnit === EMPTY_DETAILS.measurementUnit;
        const unitIsAi =
            lastUnit !== null &&
            current.purchaseUnit === lastUnit &&
            current.measurementUnit === lastUnit;
        const fillUnit = family.food && (unitIsAi || (result.unit !== null && unitUntouched));
        const unitAfter = fillUnit
            ? (result.unit ?? EMPTY_DETAILS.measurementUnit)
            : current.measurementUnit;
        const gramsIsAi = lastGrams !== null && current.gramsPerUnit === lastGrams;
        const gramsAnswer =
            result.unit === unitAfter && result.gramsPerUnit !== null
                ? String(result.gramsPerUnit)
                : '';
        const fillGrams =
            family.food &&
            (fillUnit || ((gramsIsAi || current.gramsPerUnit === '') && gramsAnswer !== ''));
        if (fillArabic || fillPair || fillLeaf || fillUnit || fillGrams) {
            if (fillUnit) {
                aiFilled.current.unit = result.unit;
                setUnitFromAi(result.unit);
            }
            if (fillGrams) {
                aiFilled.current.grams = gramsAnswer === '' ? null : gramsAnswer;
                setGramsFromAi(gramsAnswer === '' ? null : gramsAnswer);
            }
            if (fillArabic) {
                aiFilled.current.arabic = result.nameAr;
                setArabicFromAi(result.nameAr);
            }
            if (fillPair) {
                aiFilled.current.pair =
                    result.categoryCode === null
                        ? null
                        : {
                              categoryCode: result.categoryCode,
                              subcategoryCode: result.subcategoryCode ?? '',
                          };
            }
            setDetails((previous) => ({
                ...previous,
                ...(fillArabic ? { name: { ...previous.name, ar: result.nameAr ?? '' } } : {}),
                ...(fillPair
                    ? {
                          categoryCode: result.categoryCode ?? '',
                          subcategoryCode: result.subcategoryCode ?? '',
                      }
                    : {}),
                ...(fillLeaf ? { subcategoryCode: result.subcategoryCode ?? '' } : {}),
                ...(fillUnit
                    ? {
                          purchaseUnit: result.unit ?? '',
                          measurementUnit: unitAfter,
                          // Items per unit is a piece question; off the piece it goes with the field.
                          ...(unitAfter === 'piece' ? {} : { itemsPerUnit: '' }),
                      }
                    : {}),
                ...(fillGrams ? { gramsPerUnit: gramsAnswer } : {}),
            }));
            markDetailsDirty();
        }

        // The Open Food Facts product that is plainly this ingredient: preselected, never confirmed.
        const allergenPick =
            result.allergens.pick === null
                ? undefined
                : result.allergens.candidates[result.allergens.pick];
        if (allergenPick !== undefined) {
            setAllergenDraft((previous) =>
                previous.name === current.name.en && previous.selection !== undefined
                    ? previous
                    : {
                          name: current.name.en,
                          selection: { candidate: allergenPick, confirmed: false },
                      },
            );
        }

        // A pick that contradicts the name is shown, never preselected: the cook chooses.
        const nutrition = result.nutrition;
        const pick =
            nutrition === null || nutrition.pick === null
                ? undefined
                : nutrition.candidates[nutrition.pick];
        if (pick !== undefined && nutrition?.relation !== 'different') {
            setReferenceDraft((previous) =>
                previous.name === current.name.en && previous.selection !== undefined
                    ? previous
                    : {
                          name: current.name.en,
                          selection: {
                              ref: pick.ref,
                              sourceHash: pick.source_hash,
                              confirmed: false,
                          },
                          candidate: pick,
                      },
            );
        }
    };

    const runAssist = (force = false) => {
        const name = details.name.en.trim();
        if (!isCreating || !family.food || !editable || name.length < 2) return;
        if (!force && assistedName.current === name) return;
        assistedName.current = name;
        keepReferenceOnRename.current = false;
        assistSequence.current += 1;
        const sequence = assistSequence.current;
        assist.mutate(name, {
            onSuccess: (result) => {
                if (sequence === assistSequence.current) applyAssist(name, result);
            },
            onError: () => {
                // A failed call leaves the name free to be tried again on the next blur.
                if (sequence === assistSequence.current) assistedName.current = null;
            },
        });
    };

    /** "Update ingredient name": back to the name field, keeping the nutrition choice for review. */
    const renameForReference = () => {
        keepReferenceOnRename.current = true;
        focusField('kitchen-ingredient-name-en');
    };

    /** The assistant's category pair, when the form already holds a different one. */
    const categorySuggestion = (() => {
        if (assistForName === undefined || family.categoryCode !== '') return null;
        const { categoryCode, subcategoryCode } = assistForName;
        if (categoryCode === null) return null;
        if (
            details.categoryCode === categoryCode &&
            (subcategoryCode === null || details.subcategoryCode === subcategoryCode)
        ) {
            return null;
        }
        const parent = topLevelCategories(categories.data).find(
            (entry) => entry.code === categoryCode,
        );
        const leaf =
            subcategoryCode === null
                ? undefined
                : subcategoriesOf(categories.data, categoryCode).find(
                      (entry) => entry.code === subcategoryCode,
                  );
        const label = [parent, leaf]
            .filter((entry) => entry !== undefined)
            .map((entry) => displayName(entry.name, locale).value)
            .join(' › ');
        return {
            label: label === '' ? humaniseCode(categoryCode) : label,
            onApply: () => {
                edit({ categoryCode, subcategoryCode: subcategoryCode ?? '' });
            },
        };
    })();

    /** One of packaging's three, with the dirty flag like {@link edit}. */
    const editPackaging = (patch: Partial<PackagingDraft>) => {
        setPackaging((current) => ({ ...current, ...patch }));
        markDetailsDirty();
    };

    /*
     * Cost per item: the pack's price over the items in it — a figure somebody checks a delivery
     * note against. Empty rather than a zero when either half is missing, for the reason every
     * derived cell on this workspace gives: a `0.0000` would claim the item is free.
     */
    const itemsPerPack = positiveNumberOf(details.itemsPerUnit);
    const costPerItem =
        typeof packPriceValue === 'number' && itemsPerPack !== null
            ? packPriceValue / itemsPerPack
            : null;

    const nutritionEmpty =
        nutritionEditable && (data?.per100g ?? null) === null && preview === undefined;
    const allergens = data?.allergens ?? [];
    /** Checked, and carries nothing — the one empty set that is a claim rather than a gap. */
    const allergenFree = allergens.length === 0 && data?.allergensAssessedClear === true;

    const onlyRequired =
        server.items.length === 0 && shownBlockers.every((entry) => entry.required);
    const issueItems: readonly FormIssueItem[] = [...blockerItems, ...server.items];

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
            {...server.flag('purchase_unit_id')}
            label={t('kitchen:fields.purchaseUnit')}
            placeholder={t('kitchen:fields.unitPlaceholder')}
            searchable
            disabled={!editable}
            options={[
                { value: 'none', label: t('kitchen:fields.purchaseUnitNone') },
                ...savedUnitOptions(data?.purchaseUnit),
            ]}
            value={details.purchaseUnit === '' ? 'none' : details.purchaseUnit}
            onChange={(next) => {
                const purchaseUnit = next === 'none' ? '' : (next as DetailsDraft['purchaseUnit']);
                /*
                 * A food is stocked in the unit it is bought in, so the purchase unit is copied into
                 * the stock unit — which stays editable. The mass goes with the old unit (see the
                 * stock unit's own handler), and items per unit with the piece.
                 */
                const copies =
                    family.food && purchaseUnit !== '' && purchaseUnit !== details.measurementUnit;
                const stockUnit = copies ? purchaseUnit : details.measurementUnit;
                edit({
                    purchaseUnit,
                    ...(copies ? { measurementUnit: purchaseUnit, gramsPerUnit: '' } : {}),
                    ...(family.food && purchaseUnit !== 'piece' && stockUnit !== 'piece'
                        ? { itemsPerUnit: '' }
                        : {}),
                });
            }}
        />,
        <Select
            key="unit"
            testID="kitchen-ingredient-unit"
            id="kitchen-ingredient-unit"
            {...server.flag('default_unit_id')}
            label={t(family.food ? 'kitchen:fields.stockUnit' : 'kitchen:forms.issueUnit')}
            placeholder={t('kitchen:fields.unitPlaceholder')}
            searchable
            disabled={!editable}
            options={savedUnitOptions(data?.measurementUnit)}
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
                edit({
                    measurementUnit: next as MeasureUnit,
                    gramsPerUnit: '',
                    ...(family.food && next !== 'piece' && details.purchaseUnit !== 'piece'
                        ? { itemsPerUnit: '' }
                        : {}),
                });
            }}
        />,
        // A food counts its items only when it is bought or stocked by the piece; a value saved
        // before keeps the field so it is never sent unseen.
        !family.food ||
        details.purchaseUnit === 'piece' ||
        details.measurementUnit === 'piece' ||
        details.itemsPerUnit !== '' ? (
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
            />
        ) : null,
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
                // What a recipe could not convert, said on the field that converts it.
                {...(openNeed('unit') === undefined ? {} : { warning: openNeed('unit')?.message })}
                // A recipe-derived row's mass comes from the recipe and is not saved from here.
                disabled={!editable || nutritionDerived !== null}
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

    /*
     * The page's notices, one band under the opening rather than a band each: a title on a line
     * per notice, with its action where it has one. What went wrong on a save keeps the server's
     * own words, because those are the message; a notice that only explains is its title alone.
     */
    const notices = [
        platformNotice ? (
            /*
             * The notice offers the way out of the constraint in the same breath — the row *can*
             * be edited, once the kitchen takes a copy. The action is withheld from a reader
             * without manage permission rather than shown disabled: forking is a write, and a
             * control that exists only to be refused tells them less than its absence does.
             */
            <Callout
                key="platform"
                testID="kitchen-ingredient-platform-library"
                role="note"
                tone="info"
                title={t('kitchen:editor.platformLibraryTitle')}
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
        ) : null,
        forkFailure === null ? null : (
            <Callout
                key="fork-error"
                testID="kitchen-ingredient-fork-error"
                role="alert"
                tone="danger"
                title={t('kitchen:editor.forkError')}
                body={forkFailure.message}
            />
        ),
        quarantined ? (
            <Callout
                key="quarantine"
                testID="kitchen-ingredient-quarantine"
                role="alert"
                tone="warning"
                title={t('kitchen:allergens.quarantineTitle')}
            />
        ) : null,
        // Added from the recipe editor: AI-filled and owing its confirmed reference.
        data?.pendingNutrition == null ? null : (
            <Callout
                key="pending-nutrition"
                testID="kitchen-ingredient-pending-nutrition"
                role="note"
                tone="warning"
                icon="sparkle"
                title={t('kitchen:editor.pendingNutritionTitle')}
            />
        ),
        saveFailure === null || (server.isValidation && server.unplaced === null) ? null : (
            <Callout
                key="save-error"
                testID="kitchen-ingredient-save-error"
                role="alert"
                tone="danger"
                title={t('kitchen:editor.saveError')}
                body={server.unplaced ?? saveFailure.message}
            />
        ),
        photoFailure === null ? null : (
            <Callout
                key="photo-error"
                testID="kitchen-ingredient-photo-error"
                role="alert"
                tone="danger"
                title={t('kitchen:editor.saveError')}
                body={photoFailure.message}
            />
        ),
        currencyMissing ? (
            <Callout
                key="currency-missing"
                testID="kitchen-ingredient-currency-missing"
                role="alert"
                tone="warning"
                title={t('kitchen:sale.currencyUnknown')}
            />
        ) : null,
    ].filter((notice): notice is ReactElement => notice !== null);

    return (
        <Cascade space="md" testID="kitchen-ingredient-editor-screen">
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
                                    disabled={
                                        !editable || currencyMissing || busy || referenceBlocked
                                    }
                                    onPress={save}
                                />
                            )}
                        </Inline>
                    }
                />

                {/*
                 * What a recipe sent the reader here to fix: each thing by the section it is in
                 * and what to do, each a press away from its place on the page, ticked off as it
                 * is saved — and the way back to the recipe, which a Save takes by itself.
                 */}
                {needItems.length === 0 ? null : (
                    <Callout
                        testID="kitchen-ingredient-fix"
                        role="status"
                        tone={needsDone ? 'success' : 'warning'}
                        title={
                            needsDone
                                ? t('kitchen:ingredientFix.doneTitle')
                                : t('kitchen:ingredientFix.title', {
                                      count: needItems.filter((item) => !item.resolved).length,
                                  })
                        }
                        actions={
                            back.returnTo === null ? undefined : (
                                <Button
                                    testID="kitchen-ingredient-fix-back"
                                    size="sm"
                                    variant={needsDone ? 'primary' : 'secondary'}
                                    label={
                                        returnName === null
                                            ? t('kitchen:ingredientFix.back')
                                            : t('kitchen:ingredientFix.backNamed', {
                                                  name: returnName,
                                              })
                                    }
                                    onPress={() => {
                                        guard.intercept(back.leave);
                                    }}
                                />
                            )
                        }
                    >
                        <Stack space="xs">
                            {needItems.map((item) => (
                                <Pressable
                                    key={item.key}
                                    testID={`kitchen-ingredient-fix-${item.key}`}
                                    role="link"
                                    accessibilityRole="link"
                                    accessibilityLabel={`${item.section}: ${item.resolved ? t('kitchen:ingredientFix.doneItem') : item.message}`}
                                    disabled={item.resolved}
                                    onPress={() => {
                                        focusField(item.targetId);
                                    }}
                                    className="flex-row flex-wrap items-center gap-tight"
                                >
                                    <Icon
                                        name={item.resolved ? 'check' : 'warning'}
                                        size="sm"
                                        className={
                                            item.resolved
                                                ? 'text-success-strong'
                                                : 'text-warning-strong'
                                        }
                                    />
                                    <Text variant="label">{item.section}</Text>
                                    <Text tone={item.resolved ? 'success' : 'primary'}>
                                        {item.resolved
                                            ? t('kitchen:ingredientFix.doneItem')
                                            : item.message}
                                    </Text>
                                    {item.resolved ? null : (
                                        <Icon
                                            name="chevronEnd"
                                            size="sm"
                                            className="text-content-secondary"
                                        />
                                    )}
                                </Pressable>
                            ))}
                        </Stack>
                    </Callout>
                )}

                {/* One strip above the other, each the full width — never squeezed side by side. */}
                {issueItems.length === 0 && warningItems.length === 0 ? null : (
                    <Stack space="xs" testID="kitchen-ingredient-issues">
                        {issueItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-ingredient-issues-errors"
                                tone="danger"
                                summary={t(
                                    onlyRequired
                                        ? 'kitchen:forms.requiredCount'
                                        : 'kitchen:forms.toFixCount',
                                    { count: issueItems.length },
                                )}
                                items={issueItems}
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
                    </Stack>
                )}

                <View className="border-b border-stroke" />
            </Stack>

            {notices.length === 0 ? null : (
                <Stack space="xs" testID="kitchen-ingredient-notices">
                    {notices}
                </Stack>
            )}

            {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
            <View className="z-auto flex-col gap-loose">
                {/* ── identity ─────────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-ingredient-identity"
                    title={t('kitchen:forms.description')}
                >
                    <View className="z-auto flex-row flex-wrap items-start gap-base">
                        {/*
                         * The photo leads a food record and packaging has none — a bin liner is
                         * identified by its reference, and the design draws no slot for it. Written
                         * after the record's save; see `writePhoto`.
                         */}
                        {!family.food ? null : (
                            <ImageSlot
                                testID="kitchen-ingredient-image"
                                uri={photo}
                                fallback={stockPhoto}
                                disabled={!editable}
                                onChange={(next) => {
                                    // Clearing takes the stock picture off as well as an upload;
                                    // an upload puts it back on, server side, when it is saved.
                                    const hidden = next === null;
                                    setPhoto(next);
                                    setStockHidden(hidden);
                                    const changed =
                                        next !== (data?.photoUrl ?? null) ||
                                        (hasStockPhoto && hidden !== savedStockHidden);
                                    setPhotoDirty(changed);
                                    if (changed) guard.markDirty();
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
                                {...(server.errorFor('name_en') === undefined ||
                                flagEnglish.englishError !== undefined
                                    ? {}
                                    : { englishError: server.errorFor('name_en') })}
                                {...(server.errorFor('name_ar') === undefined
                                    ? {}
                                    : { arabicError: server.errorFor('name_ar') })}
                                onChange={(next) => {
                                    edit({ name: next });
                                }}
                                onEnglishBlur={() => {
                                    runAssist();
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
                                {...server.flag('ingredient_category_id')}
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
                                {...server.flag('ingredient_subcategory_id')}
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
                    {isCreating && family.food ? (
                        <IngredientAssistPanel
                            result={assistForName}
                            pending={assist.isPending}
                            arabicFromAi={arabicFromAi !== null && details.name.ar === arabicFromAi}
                            unitFromAi={
                                unitFromAi !== null &&
                                details.measurementUnit === unitFromAi &&
                                details.purchaseUnit === unitFromAi
                                    ? t(unitKey(unitFromAi))
                                    : null
                            }
                            gramsFromAi={
                                gramsFromAi !== null && details.gramsPerUnit === gramsFromAi
                                    ? {
                                          grams: gramsFromAi,
                                          unit: t(unitShortKey(details.measurementUnit)),
                                      }
                                    : null
                            }
                            categorySuggestion={categorySuggestion}
                            onOpen={(id) => {
                                router.push(`/kitchen/ingredients/${String(id)}`);
                            }}
                            onRerun={() => {
                                runAssist(true);
                            }}
                        />
                    ) : null}
                </FormSection>

                {/* ── measurement & cost / pack ────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
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
                        {/*
                         * Read-only: what the kitchen last paid, per the unit it was bought in, and
                         * from whom. It follows the receipts — the next delivery posted moves it.
                         */}
                        {!family.food ? null : (
                            <QuantityInput
                                testID="kitchen-ingredient-unit-price"
                                id="kitchen-ingredient-unit-price"
                                size="sm"
                                readOnly
                                label={t('kitchen:fields.unitPrice')}
                                placeholder={currentPricePlaceholder}
                                value={currentPriceValue}
                                {...(openNeed('price') === undefined
                                    ? {}
                                    : { warning: openNeed('price')?.message })}
                                {...(latestPurchase === null ||
                                latestPurchase.unitPriceAmount === null
                                    ? {}
                                    : {
                                          unit: t('kitchen:fields.unitPricePer', {
                                              currency: latestPurchase.costCurrencyCode ?? '',
                                              unit: latestPurchase.unitCode ?? '',
                                          }),
                                          hint: currentPriceSource,
                                      })}
                                onChangeText={() => {}}
                            />
                        )}

                        {/*
                         * What one item holds, in two cells: the figure and its unit. Packaging
                         * only — a cap or a label holds nothing and leaves it blank.
                         */}
                        {family.food ? null : (
                            <QuantityInput
                                testID="kitchen-ingredient-capacity"
                                id="kitchen-ingredient-capacity"
                                size="sm"
                                label={t('kitchen:forms.holds')}
                                placeholder={t('kitchen:fields.quantityPlaceholder')}
                                value={packaging.capacity}
                                disabled={!editable}
                                {...server.flag('capacity_quantity')}
                                onChangeText={(next) => {
                                    editPackaging({ capacity: next });
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
                                options={adminUnitsWith(packaging.capacityUnit).map((unit) => ({
                                    value: unit,
                                    label: t(unitShortKey(unit)),
                                }))}
                                value={packaging.capacityUnit}
                                onChange={(next) => {
                                    editPackaging({ capacityUnit: next as MeasureUnit });
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
                        variant="card"
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
                                value={packaging.packPrice}
                                disabled={!editable}
                                {...priceUnit}
                                {...flag('pack-price', t('kitchen:sale.priceInvalid'))}
                                {...server.flag('purchase_price_amount')}
                                {...(openNeed('price') === undefined
                                    ? {}
                                    : { warning: openNeed('price')?.message })}
                                onChangeText={(next) => {
                                    editPackaging({ packPrice: next });
                                }}
                            />
                            <QuantityInput
                                testID="kitchen-ingredient-waste"
                                id="kitchen-ingredient-waste"
                                size="sm"
                                label={t('kitchen:forms.waste')}
                                placeholder={t('kitchen:fields.percentPlaceholder')}
                                unit="%"
                                value={packaging.wastePercent}
                                disabled={!editable}
                                {...(wasteHigh
                                    ? {
                                          warning: t('kitchen:forms.aboveWaste', {
                                              percent: WASTE_WARNING_PERCENT,
                                          }),
                                      }
                                    : {})}
                                {...server.flag('waste_percent')}
                                onChangeText={(next) => {
                                    editPackaging({ wastePercent: withoutMinus(next) });
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
                        variant="card"
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
                                        {...server.flag('b2b_price_amount')}
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
                                        {...server.flag('b2c_price_amount')}
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
                        variant="card"
                        testID="kitchen-ingredient-nutrition"
                        title={t('kitchen:forms.nutritionTitle')}
                        {...(nutritionDerived === null && editable && !isPackaging
                            ? {
                                  description: `${t('kitchen:nutritionLookup.serverManaged')} ${t('kitchen:nutritionLookup.allergensSeparate')}`,
                              }
                            : {})}
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
                        <NeedLine
                            nativeID={NEED_TARGET.nutrition}
                            message={openNeed('nutrition')?.message}
                        />
                        {nutritionDerived === null ? (
                            <Stack space="sm">
                                {/*
                                 * The same cards the recipe's technical sheet draws — one shape
                                 * for an ingredient's nutrition and a recipe's, which is how the
                                 * design sets them. Read from the record, never typed: see the
                                 * file header.
                                 */}
                                <DerivedPanel
                                    testID="kitchen-ingredient-nutrition-grid"
                                    variant="outline"
                                    figures={figures}
                                    emptyValue={t('kitchen:sale.marginUnavailable')}
                                />

                                {/* Where the saved figures came from: data, so it stays on the page. */}
                                {data?.nutritionNote == null ? null : (
                                    <Text tone="secondary" variant="caption">
                                        {data.nutritionNote}
                                    </Text>
                                )}
                                {editable && !isPackaging ? (
                                    <NutritionReferencePicker
                                        key={`${String(data?.id ?? 'new')}:${details.name.en}`}
                                        name={details.name.en}
                                        value={nutritionReference}
                                        valueCandidate={
                                            referenceDraft.name === details.name.en
                                                ? referenceDraft.candidate
                                                : undefined
                                        }
                                        suggestion={
                                            assistForName?.nutrition ??
                                            // The quick add's stored pick, offered — never chosen —
                                            // so saving anything else here is not held behind it.
                                            (data?.pendingNutrition?.suggestion == null
                                                ? undefined
                                                : {
                                                      candidates: [
                                                          data.pendingNutrition.suggestion,
                                                      ],
                                                      pick: 0,
                                                      relation: null,
                                                      reason: null,
                                                  })
                                        }
                                        onRename={isCreating ? renameForReference : undefined}
                                        onChange={(selection, candidate) => {
                                            setReferenceDraft({
                                                name: details.name.en,
                                                selection,
                                                candidate,
                                            });
                                            setDetailsDirty(true);
                                            guard.markDirty();
                                        }}
                                    />
                                ) : null}
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

                {/* ── allergens (food) ─────────────────────────────────────────────────────── */}
                {!family.food ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-ingredient-allergens"
                        title={t('kitchen:forms.allergensTitle')}
                        {...(editable ? { description: t('kitchen:allergenLookup.guidance') } : {})}
                        aside={
                            <Inline space="xs" align="center" wrap>
                                {editable ? null : (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-allergens-source"
                                        tone="info"
                                        label={t('kitchen:composition.fromDatabase')}
                                    />
                                )}
                                {/* Checked and empty: said on the heading, where the eye lands. */}
                                {allergenFree ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-ingredient-allergens-none-badge"
                                        tone="success"
                                        label={t('kitchen:allergens.noneBadge')}
                                    />
                                ) : null}
                            </Inline>
                        }
                    >
                        <NeedLine
                            nativeID={NEED_TARGET.allergens}
                            message={openNeed('allergens')?.message}
                        />
                        {isCreating && classes.data !== undefined ? (
                            <AllergenReferencePicker
                                key={details.name.en}
                                name={details.name.en}
                                classes={classes.data}
                                value={allergenReference}
                                suggestion={assistForName?.allergens}
                                onChange={(selection) =>
                                    setAllergenDraft({ name: details.name.en, selection })
                                }
                            />
                        ) : null}
                        {isCreating &&
                        allergenReference === undefined &&
                        aiAllergenCodes.length > 0 ? (
                            <Callout
                                testID="kitchen-ingredient-ai-allergens"
                                tone="warning"
                                icon="sparkle"
                                title={t('kitchen:assist.allergensIndicated')}
                                {...(assistForName?.allergens.reason == null
                                    ? {}
                                    : { body: assistForName.allergens.reason })}
                            >
                                <Stack space="xs">
                                    <TagRow
                                        items={aiAllergenCodes.map((entry) => ({
                                            key: String(entry.allergenCode),
                                            tone:
                                                entry.containment === 'contains'
                                                    ? 'danger'
                                                    : 'warning',
                                            label: `${allergenClassName(entry.allergenCode)} · ${t(containmentKey(entry.containment))}`,
                                        }))}
                                    />
                                    <Checkbox
                                        testID="kitchen-ingredient-ai-allergens-confirm"
                                        label={t('kitchen:assist.allergensConfirm')}
                                        checked={aiAllergensConfirmed}
                                        disabled={!editable}
                                        onChange={(checked) => {
                                            setAiAllergensConfirmedFor(
                                                checked ? details.name.en.trim() : null,
                                            );
                                            guard.markDirty();
                                        }}
                                    />
                                </Stack>
                            </Callout>
                        ) : null}
                        {isCreating &&
                        allergenReference === undefined &&
                        assistForName?.allergens.codes?.length === 0 ? (
                            <Text
                                testID="kitchen-ingredient-ai-allergens-none"
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:assist.allergensNone')}
                            </Text>
                        ) : null}
                        {isCreating && allergenReference === undefined && !aiAllergensConfirmed ? (
                            <Checkbox
                                testID="kitchen-ingredient-no-allergens"
                                label={t('kitchen:allergens.createNone')}
                                checked={noAllergens}
                                disabled={!editable}
                                onChange={(checked) => {
                                    setNoAllergens(checked);
                                    guard.markDirty();
                                }}
                            />
                        ) : null}
                        {editable && data !== undefined && classes.data !== undefined ? (
                            <IngredientAllergenEditor
                                key={`${data.allergenReviewToken ?? ''}-${String(data.meta.lockVersion)}-${allergens
                                    .map((m) => `${String(m.allergenCode)}:${m.containment}`)
                                    .join(',')}-${String(data.allergensAssessedClear === true)}`}
                                ingredient={data}
                                classes={classes.data}
                                onDirtyChange={setAllergensDirty}
                            />
                        ) : isCreating ? null : allergenFree ? (
                            <Tag
                                testID="kitchen-ingredient-allergens-none"
                                tone="success"
                                label={t('kitchen:allergens.noneBadge')}
                            />
                        ) : allergens.length === 0 ? (
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

                {/*
                 * ── barcodes ─ the kitchen's own rows, written on the spot rather than by Save, so
                 * a platform record and packaging have them too. A saved record only: a code needs
                 * an ingredient to point at.
                 */}
                {parsed === null ? null : (
                    <IngredientBarcodesSection
                        ingredientId={parsed}
                        defaultUnit={details.measurementUnit}
                        canManage={canManage}
                    />
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
        </Cascade>
    );
}

/**
 * What a recipe needs from this section, said at the top of it — the line a fix lands on
 * (`NEED_TARGET`). Nothing at all once it is done, or when no recipe asked.
 */
function NeedLine({
    message,
    nativeID,
}: {
    readonly message: string | undefined;
    readonly nativeID: string;
}) {
    if (message === undefined) return null;
    return (
        <View nativeID={nativeID} testID={nativeID} className="flex-row items-center gap-tight">
            <Icon name="warning" size="sm" className="text-warning-strong" />
            <Text variant="label" tone="warning">
                {message}
            </Text>
        </View>
    );
}
