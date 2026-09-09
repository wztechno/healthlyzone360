import type {
    AllergenClass,
    CostAmount,
    IngredientAdmin,
    LocalisedText,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    ErrorState,
    FormGrid,
    FormSection,
    Inline,
    QuantityInput,
    Select,
    Skeleton,
    Stack,
    Switch,
    Tag,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption, TagTone } from '@healthy360/design-system';
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
import {
    UNIT_DIMENSIONS,
    amountToInput,
    displayName,
    humaniseCode,
    marginPercent,
    parseAmount,
    statusKey,
    statusTone,
    unitDimension,
    unitDimensionKey,
    unitKey,
} from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/ingredients/{ingredient}` — the record editor, as `Catalogue.dc.html` draws it
 * (`isIngredientEdit`, around line 640).
 *
 * ```
 * Kitchen workspace › Ingredients › Mayonnaise      <- the shell's trail, now three crumbs
 * Mayonnaise                                  [ Cancel ]  [ Save ]
 * IG-019 · Condiments · Live · last changed 2 days ago
 * IDENTITY ─────────────────────────────────────────────────────────────────────
 *   Designation (EN)   Designation (AR)   Category
 *   Sub-category
 * MEASUREMENT & COST ───────────────────────────────────────────────────────────
 *   Stock unit    Purchase unit    Unit price
 *   Items per purchase unit
 * SALE  Sold as-is, outside recipes ─────────────────────────────────────────────
 *   ●━━  Available for sale   On — pricing required
 *   B2B price     B2C price        Margin on cost
 * COMPOSITION & ALLERGENS  FROM DATABASE ───────────────────────────────────────
 *   ENERGY 680 · FAT 74.8 · CARBS 1.4 · PROTEIN 1.1
 *   ( Egg ) ( Mustard )
 * ```
 *
 * Four sections, in the design's order, holding the design's fields and nothing else. Sections, not
 * cards: §1.3 retires panel outlines in the Catalogue, so a section is a title, a hairline and its
 * content. Every field sits on a fixed 280px track (`FormGrid`'s no-stretch rule, §2), so a
 * two-character unit picker is 280px on a laptop and 280px on a desk monitor; what a wider viewport
 * buys is a third column, never a wider field.
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
 * ## Composition and allergens are read-only — handoff §6.2
 *
 * Nutrients and allergen classes resolve from the reference food database and are rendered for
 * confirmation on the sunken fill under a `From database` badge. No input, no override; a correction
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
    /** The three prices as typed. Parsed on save; `''` clears. */
    readonly unitPrice: string;
    readonly b2bPrice: string;
    readonly b2cPrice: string;
    readonly isSellable: boolean;
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    reference: '',
    categoryCode: '',
    subcategoryCode: '',
    measurementUnit: 'g',
    purchaseUnit: '',
    itemsPerUnit: '',
    unitPrice: '',
    b2bPrice: '',
    b2cPrice: '',
    isSellable: false,
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
        unitPrice: amountToInput(ingredient.unitPrice),
        b2bPrice: amountToInput(ingredient.b2bPrice),
        b2cPrice: amountToInput(ingredient.b2cPrice),
        isSellable: ingredient.isSellable,
    };
}

/** The draft's items-per-unit as a number, or null for blank/unparseable. */
function itemsPerUnitOf(draft: DetailsDraft): number | null {
    const trimmed = draft.itemsPerUnit.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The four figures the design's composition panel shows, in its order.
 *
 * The label keys are written out rather than assembled from the id. The two vocabularies are not the
 * same list and only look like it: `nutrientId` is the nutrition package's identifier and the
 * catalogue key is a translator-facing name, so `nutrition:nutrients.${id}` is a coincidence that
 * holds for these four and breaks on the fifth. Written out, a key that does not exist is a compile
 * error against `keys.generated.ts`; interpolated, it is an English string appearing in Arabic at
 * run time.
 */
const PANEL_NUTRIENTS: readonly { readonly id: string; readonly labelKey: string }[] = [
    { id: 'energy', labelKey: 'nutrition:nutrients.energy' },
    { id: 'fat', labelKey: 'nutrition:nutrients.fat' },
    { id: 'carbohydrate', labelKey: 'nutrition:nutrients.carbohydrate' },
    { id: 'protein', labelKey: 'nutrition:nutrients.protein' },
];

/**
 * The four tiles, always four, whether or not the record has facts behind them.
 *
 * A figure the record has not got comes back `null` and the panel draws an em dash in its place.
 * The row does not collapse to a sentence: see `DerivedPanel` for why an absent figure is still a
 * tile, and why it is never a zero.
 *
 * The unit falls back to the nutrient's own definition when there is no amount to read it from —
 * `kcal / 100 g` is true of the energy tile whether or not this ingredient has an energy figure.
 */
function nutrientFigures(
    facts: NutritionFacts | null,
    t: TFunction,
    formatter: Formatter,
): readonly DerivedFigure[] {
    return PANEL_NUTRIENTS.flatMap((nutrient) => {
        const definition = coreNutrientDefinition(nutrient.id);
        if (definition === null) return [];

        const amount = facts === null ? null : findAmount(facts, nutrient.id);

        return [
            {
                key: nutrient.id,
                label: t(nutrient.labelKey),
                value:
                    amount === null
                        ? null
                        : formatter.formatNumber(amount.value, {
                              minimumFractionDigits: definition.precision,
                              maximumFractionDigits: definition.precision,
                          }),
                unit: t('kitchen:composition.per100g', {
                    unit: amount?.unit ?? definition.unit,
                }),
            },
        ];
    });
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface IngredientEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly ingredient: string | undefined;
}

export function IngredientEditScreen({ ingredient }: IngredientEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredient-editor"
        >
            <IngredientEditor ingredient={ingredient} />
        </Gate>
    );
}

function IngredientEditor({ ingredient }: IngredientEditScreenProps) {
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
    // The handle this record is about to take — `ING-307` — read from the same scan the create
    // performs. Only while creating; a saved row has one of its own. It is a preview and not a
    // reservation, so two forms open at once are both shown it and the second save lands at 308.
    const nextReference = useNextReferenceQuery('ING-', isCreating);

    const create = useCreateIngredientMutation();
    const update = useUpdateIngredientMutation();
    const fork = useForkIngredientMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
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
    }

    const title = isCreating
        ? t('kitchen:editor.createTitle')
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
     */
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            UNIT_DIMENSIONS.flatMap((dimension) =>
                MEASURE_UNITS.filter((unit) => unitDimension(unit) === dimension).map((unit) => ({
                    value: unit,
                    label: t(unitKey(unit)),
                    description: t(unitDimensionKey(dimension)),
                })),
            ),
        [t],
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
        for (const entry of topLevelCategories(categories.data)) {
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
    }, [categories.data, details.categoryCode, locale]);

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
    const pricesInvalid =
        unitPriceValue === undefined || b2bPriceValue === undefined || b2cPriceValue === undefined;

    // A price cannot be written without a currency to write it in, so an amount typed with no
    // currency resolved is a blocked save rather than a guess.
    const currencyMissing =
        currency === null &&
        [unitPriceValue, b2bPriceValue, b2cPriceValue].some((value) => typeof value === 'number');

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
        if (!editable || nameMissing || categoryMissing || pricesInvalid || currencyMissing) return;

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
                    ...(itemsPerUnitOf(details) === null
                        ? {}
                        : { itemsPerUnit: itemsPerUnitOf(details)! }),
                    ...(costOf(unitPriceValue) === null
                        ? {}
                        : { unitPrice: costOf(unitPriceValue)! }),
                    ...(costOf(b2bPriceValue) === null ? {} : { b2bPrice: costOf(b2bPriceValue)! }),
                    ...(costOf(b2cPriceValue) === null ? {} : { b2cPrice: costOf(b2cPriceValue)! }),
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
                        router.replace(`/kitchen/ingredients/${String(created.id)}` as never);
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
                    itemsPerUnit: itemsPerUnitOf(details),
                    unitPrice: costOf(unitPriceValue),
                    b2bPrice: costOf(b2bPriceValue),
                    b2cPrice: costOf(b2cPriceValue),
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
        router.push('/kitchen/ingredients' as never);
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
            <Stack space="md" testID="kitchen-ingredient-editor-loading">
                <Skeleton testID="kitchen-ingredient-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-ingredient-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-ingredient-skeleton-3" heightClassName="h-32" />
            </Stack>
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
                router.replace(`/kitchen/ingredients/${String(created.id)}` as never);
            },
        });
    };

    const forkFailure = toFailure(fork.error);

    const saveFailure = toFailure(update.error ?? create.error);
    const figures = nutrientFigures(data?.per100g ?? null, t, formatter);

    // `IG-019 · Condiments`. Built from the draft rather than the record so the line tracks an edit
    // in progress: change the category and the header agrees with the field under it before the
    // save, which is the whole reason a reader looks up there.
    // The catalogue's own name for the chosen category, via the options the picker is showing --
    // which always contain the chosen code, so this never falls through on a real value.
    const categoryLabel =
        categoryOptions.find((option) => option.value === details.categoryCode)?.label ?? '';

    // Creating, the reference is the one the save is about to assign rather than one the record
    // carries — the meta line is where this screen states a record's handle, so it is where the
    // number belongs. Empty while the read is in flight, and empty if it fails: a blank is what
    // this line held before the series existed, and better than a number nothing stands behind.
    const reference = isCreating ? (nextReference.data ?? '') : details.reference.trim();

    const identity = [reference, categoryLabel]
        .filter((part) => part !== '')
        .join(t('kitchen:editor.metaSeparator'));

    return (
        <Stack space="md" testID="kitchen-ingredient-editor-screen">
            {/*
             * The opening — title, actions and the meta line — is one 4px block inside the page's
             * 16px rhythm, exactly as the list next door tightens its own header. No trail here:
             * `KitchenOpsShell` draws it, and this screen names its last crumb instead.
             */}
            <Stack space="xs">
                <CataloguePageHeader
                    testID="kitchen-ingredient-editor-screen-header"
                    titleTestID="kitchen-ingredient-editor-screen-title"
                    title={title}
                    primaryAction={
                        <Inline space="xs" align="center">
                            {/*
                             * Both actions are `md`, matching the list page's `Import` and
                             * `New ingredient` pair — an editor's Cancel and Save are the same
                             * decision at the same weight, and the design draws them at one height.
                             * This is the exception §3 allows to the Catalogue's `sm` default, and
                             * the only place on the page that takes it.
                             */}
                            <Button
                                testID="kitchen-ingredient-editor-screen-back"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(goBack);
                                }}
                            />
                            {/*
                             * The page's one `md`, per §3. Hidden rather than permanently disabled
                             * on a record this caller cannot write: a save that can never be
                             * pressed is furniture, and the callout above already says why. A
                             * platform row an operator *can* write keeps its Save.
                             */}
                            {platformNotice ? null : (
                                <Button
                                    testID="kitchen-ingredient-editor-screen-save"
                                    label={t('kitchen:editor.save')}
                                    loading={create.isPending || update.isPending}
                                    disabled={
                                        !editable ||
                                        nameMissing ||
                                        categoryMissing ||
                                        pricesInvalid ||
                                        currencyMissing ||
                                        create.isPending ||
                                        update.isPending
                                    }
                                    onPress={save}
                                />
                            )}
                        </Inline>
                    }
                />

                <Inline
                    space="xs"
                    align="center"
                    wrap
                    testID="kitchen-ingredient-editor-screen-meta"
                >
                    {identity === '' ? null : (
                        <Text
                            testID="kitchen-ingredient-editor-screen-identity"
                            tone="secondary"
                            variant="caption"
                        >
                            {identity}
                        </Text>
                    )}
                    {data === undefined ? (
                        <Badge
                            testID="kitchen-ingredient-editor-screen-status"
                            tone="neutral"
                            icon="dot"
                            label={t('kitchen:status.draft')}
                        />
                    ) : (
                        <Badge
                            testID="kitchen-ingredient-editor-screen-status"
                            tone={statusTone(data.meta.status)}
                            label={t(statusKey(data.meta.status))}
                        />
                    )}
                    {guard.isDirty ? (
                        <Badge
                            testID="kitchen-ingredient-editor-screen-dirty"
                            tone="warning"
                            icon="warning"
                            label={t('kitchen:editor.unsaved')}
                        />
                    ) : null}
                    <Text
                        testID="kitchen-ingredient-editor-screen-updated"
                        tone="secondary"
                        variant="caption"
                    >
                        {data === undefined
                            ? t('kitchen:editor.neverSaved')
                            : data.meta.updatedByName === null
                              ? t('kitchen:editor.lastUpdatedBySeed', {
                                    when: formatter.formatRelativeTime(data.meta.updatedAt),
                                })
                              : t('kitchen:editor.lastUpdatedBy', {
                                    when: formatter.formatRelativeTime(data.meta.updatedAt),
                                    name: data.meta.updatedByName,
                                })}
                    </Text>
                </Inline>
            </Stack>

            {platformNotice ? (
                /*
                 * The notice states the constraint and offers the way out of it in the
                 * same breath. It used to state the constraint alone, which left "cannot
                 * be edited here" as a dead end — the row *can* be edited, once the
                 * kitchen takes a copy, and a reader has no way to discover that from a
                 * sentence saying it cannot.
                 *
                 * The action is withheld from a reader without manage permission rather
                 * than shown disabled: forking is a write, and a control that exists only
                 * to be refused tells them less than its absence does.
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
            {data?.forkedFromId == null ? null : (
                /*
                 * Provenance on the copy. Without it a fork is indistinguishable from a
                 * row the kitchen typed itself, and the one question it raises — "why is
                 * there no library row for this?" — has no answer on the page. It also
                 * says plainly that the link is one-way, because a reader who assumes
                 * platform corrections still flow through would be wrong.
                 */
                <Callout
                    testID="kitchen-ingredient-forked-from"
                    role="note"
                    tone="info"
                    title={t('kitchen:editor.forkedFromTitle')}
                    body={t('kitchen:editor.forkedFromBody')}
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

            {/* ── identity ─────────────────────────────────────────────────────────────────── */}
            <FormSection
                first
                testID="kitchen-ingredient-identity"
                title={t('kitchen:editor.sectionIdentity')}
            >
                <FormGrid testID="kitchen-ingredient-identity-grid">
                    {/*
                     * Two cells of the same row, as the design draws them — `layout="row"` puts the
                     * halves side by side inside the two tracks `span={2}` claims. It stays one
                     * `BilingualField` rather than two inputs because that component owns the
                     * per-language writing direction, the missing-Arabic badge and the copy-across
                     * control, none of which the design's bare pair has and all of which the Arabic
                     * surfaces need.
                     */}
                    <BilingualField
                        span={2}
                        layout="row"
                        testID="kitchen-ingredient-name"
                        fieldLabel={t('kitchen:fields.designation')}
                        value={details.name}
                        requiredEnglish
                        disabled={!editable}
                        {...(nameMissing ? { englishError: t('kitchen:editor.nameRequired') } : {})}
                        onChange={(next) => {
                            setDetails({ ...details, name: next });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-ingredient-category"
                        id="kitchen-ingredient-category"
                        label={t('kitchen:fields.category')}
                        placeholder={t('kitchen:fields.categoryPlaceholder')}
                        searchable
                        required
                        disabled={!editable}
                        options={categoryOptions}
                        value={details.categoryCode === '' ? null : details.categoryCode}
                        {...(categoryMissing
                            ? { error: t('kitchen:editor.categoryRequired') }
                            : {})}
                        onChange={(next) => {
                            // Changing the parent invalidates the leaf: a sub-category from the
                            // previous branch would be refused by the server on save, and refusing
                            // it here costs the reader nothing they have not already decided.
                            setDetails({ ...details, categoryCode: next, subcategoryCode: '' });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-ingredient-subcategory"
                        id="kitchen-ingredient-subcategory"
                        label={t('kitchen:fields.subcategory')}
                        hint={t('kitchen:fields.subcategoryHint')}
                        placeholder={t('kitchen:fields.subcategoryPlaceholder')}
                        searchable
                        disabled={!editable || details.categoryCode === ''}
                        options={subcategoryOptions}
                        value={details.subcategoryCode === '' ? 'none' : details.subcategoryCode}
                        onChange={(next) => {
                            setDetails({
                                ...details,
                                subcategoryCode: next === 'none' ? '' : next,
                            });
                            markDetailsDirty();
                        }}
                    />
                </FormGrid>
            </FormSection>

            {/* ── measurement & cost ───────────────────────────────────────────────────────── */}
            <FormSection
                testID="kitchen-ingredient-measurement"
                title={t('kitchen:editor.sectionMeasurement')}
            >
                <FormGrid testID="kitchen-ingredient-measurement-grid">
                    <Select
                        testID="kitchen-ingredient-unit"
                        id="kitchen-ingredient-unit"
                        label={t('kitchen:fields.stockUnit')}
                        searchable
                        disabled={!editable}
                        options={unitOptions}
                        value={details.measurementUnit}
                        onChange={(next) => {
                            setDetails({ ...details, measurementUnit: next as MeasureUnit });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-ingredient-purchase-unit"
                        id="kitchen-ingredient-purchase-unit"
                        label={t('kitchen:fields.purchaseUnit')}
                        searchable
                        disabled={!editable}
                        options={[
                            { value: 'none', label: t('kitchen:fields.purchaseUnitNone') },
                            ...unitOptions,
                        ]}
                        value={details.purchaseUnit === '' ? 'none' : details.purchaseUnit}
                        onChange={(next) => {
                            setDetails({
                                ...details,
                                purchaseUnit:
                                    next === 'none' ? '' : (next as DetailsDraft['purchaseUnit']),
                            });
                            markDetailsDirty();
                        }}
                    />

                    {/*
                     * `QuantityInput`, not `TextInputField`: the design sets every figure on this
                     * screen in IBM Plex Mono, flush to the trailing edge, which is the whole reason
                     * that component exists (§1.2). The currency rides in the unit slot as a static
                     * suffix rather than in the value — a price carrying its own currency is a
                     * string no cost cascade can multiply.
                     */}
                    <QuantityInput
                        testID="kitchen-ingredient-unit-price"
                        id="kitchen-ingredient-unit-price"
                        size="sm"
                        label={t('kitchen:fields.unitPrice')}
                        value={details.unitPrice}
                        disabled={!editable}
                        {...(currency === null ? {} : { unit: currency })}
                        {...(unitPriceValue === undefined
                            ? { error: t('kitchen:sale.priceInvalid') }
                            : {})}
                        onChangeText={(next) => {
                            setDetails({ ...details, unitPrice: next });
                            markDetailsDirty();
                        }}
                    />

                    <QuantityInput
                        testID="kitchen-ingredient-items-per-unit"
                        id="kitchen-ingredient-items-per-unit"
                        size="sm"
                        label={t('kitchen:fields.itemsPerPurchaseUnit')}
                        value={details.itemsPerUnit}
                        disabled={!editable}
                        onChangeText={(next) => {
                            setDetails({ ...details, itemsPerUnit: next });
                            markDetailsDirty();
                        }}
                    />
                </FormGrid>
            </FormSection>

            {/* ── sale ─────────────────────────────────────────────────────────────────────── */}
            <FormSection
                testID="kitchen-ingredient-sale"
                title={t('kitchen:sale.title')}
                aside={
                    <Text variant="caption" tone="secondary">
                        {t('kitchen:sale.eyebrow')}
                    </Text>
                }
            >
                <Stack space="sm">
                    <Switch
                        testID="kitchen-ingredient-sellable"
                        id="kitchen-ingredient-sellable"
                        label={t('kitchen:sale.toggleLabel')}
                        stateLabel={
                            details.isSellable
                                ? t('kitchen:sale.stateOn')
                                : t('kitchen:sale.stateOff')
                        }
                        checked={details.isSellable}
                        disabled={!editable}
                        onChange={(next) => {
                            setDetails({ ...details, isSellable: next });
                            markDetailsDirty();
                        }}
                    />

                    {/*
                     * The prices appear only while the ingredient is sold, as the design's `sc-if`
                     * does. They are not cleared on toggling off: an ingredient taken off sale for a
                     * season keeps the prices it had, and re-listing it is one switch rather than one
                     * switch and two figures somebody has to find again.
                     */}
                    {details.isSellable ? (
                        <FormGrid testID="kitchen-ingredient-sale-grid">
                            <QuantityInput
                                testID="kitchen-ingredient-b2b-price"
                                id="kitchen-ingredient-b2b-price"
                                size="sm"
                                label={t('kitchen:sale.b2bPrice')}
                                hint={t('kitchen:sale.b2bPriceHint')}
                                value={details.b2bPrice}
                                disabled={!editable}
                                {...(currency === null ? {} : { unit: currency })}
                                {...(b2bPriceValue === undefined
                                    ? { error: t('kitchen:sale.priceInvalid') }
                                    : {})}
                                onChangeText={(next) => {
                                    setDetails({ ...details, b2bPrice: next });
                                    markDetailsDirty();
                                }}
                            />

                            <QuantityInput
                                testID="kitchen-ingredient-b2c-price"
                                id="kitchen-ingredient-b2c-price"
                                size="sm"
                                label={t('kitchen:sale.b2cPrice')}
                                hint={t('kitchen:sale.b2cPriceHint')}
                                value={details.b2cPrice}
                                disabled={!editable}
                                {...(currency === null ? {} : { unit: currency })}
                                {...(b2cPriceValue === undefined
                                    ? { error: t('kitchen:sale.priceInvalid') }
                                    : {})}
                                onChangeText={(next) => {
                                    setDetails({ ...details, b2cPrice: next });
                                    markDetailsDirty();
                                }}
                            />

                            {/*
                             * The derived third cell, drawn with the same `readOnly` variant the
                             * cost cascade's totals use — a figure on the sunken fill, in a field's
                             * shape, that nobody types into. Empty rather than a stand-in figure
                             * when the sum cannot be stated: the placeholder's em dash says "not
                             * calculable", where a `0.0` would claim the margin is nil.
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
                                hint={
                                    margin === null || typeof unitPriceValue !== 'number'
                                        ? t('kitchen:sale.marginNoBasis')
                                        : t('kitchen:sale.marginHint', {
                                              price: formatter.formatNumber(unitPriceValue, {
                                                  minimumFractionDigits: 2,
                                                  maximumFractionDigits: 2,
                                              }),
                                          })
                                }
                                onChangeText={() => undefined}
                            />
                        </FormGrid>
                    ) : null}
                </Stack>
            </FormSection>

            {/* ── composition & allergens, read-only per §6.2 ──────────────────────────────── */}
            <FormSection
                testID="kitchen-ingredient-allergens"
                title={t('kitchen:composition.title')}
                aside={
                    <Badge tone="info" icon={null} label={t('kitchen:composition.fromDatabase')} />
                }
            >
                <DerivedPanel
                    testID="kitchen-ingredient-composition"
                    description={t('kitchen:composition.description')}
                    figures={figures}
                    emptyValue={t('kitchen:sale.marginUnavailable')}
                    chips={(data?.allergens ?? []).map((mapping) => {
                        const code = String(mapping.allergenCode);
                        const known = classByCode.get(code);
                        // `contains` and `may_contain` are two different claims and never one
                        // colour: the tone separates them, and the class name carries the rest.
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
            </FormSection>

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
