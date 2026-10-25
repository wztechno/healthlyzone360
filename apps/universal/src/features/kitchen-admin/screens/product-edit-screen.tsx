import type {
    LocalisedText,
    MeasurementUnitOption,
    ProductAdmin,
    ProductPackVariant,
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
    Tag,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { FormIssueItem, SelectOption } from '@healthy360/design-system';
import { ProductId, SALES_CHANNELS, isCurrencyCode } from '@healthy360/domain-types';
import type { RecipeId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    ChannelPricesSection,
    EMPTY_CHANNEL_PRICE_DRAFT,
    channelPriceDraftValid,
    useWriteChannelPriceDraft,
} from '../channel-prices-section.tsx';
import type { ChannelPriceDraft } from '../channel-prices-section.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useArchiveProductMutation,
    useCreateProductMutation,
    useProductCategoriesQuery,
    useProductQuery,
    usePublishProductMutation,
    useAllRecipesQuery,
    useSaveRecordPhotoMutation,
    useSellableChannelsQuery,
    useSetProductChannelAvailabilityMutation,
    useUpdateProductMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    useItemLatestPurchasesQuery,
    useProcurementReferenceQuery,
    useStockItemsQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { stockBlockersSentence } from '../catalogue/recipe-columns.tsx';
import {
    ChannelAvailabilityEditor,
    PackVariantEditor,
    channelRequest,
    emptyPack,
    firstPackErrorColumn,
    packErrors,
} from '../catalogue-row-editors.tsx';
import type {
    ChannelDraft,
    PackColumn,
    PackDraft,
    PackRowErrors,
} from '../catalogue-row-editors.tsx';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    INVENTORY_VIEW_COSTS_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { useHostSave } from '../host-save.ts';
import type { RegisterHostSave } from '../host-save.ts';
import {
    adminReferenceUnits,
    dietClassificationKey,
    displayName,
    humaniseCode,
    parseQuantity,
    parseWholeNumber,
    statusKey,
    statusTone,
    unitCodeLabel,
} from '../format.ts';
import { ImageSlot } from '../image-slot.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { focusFirstRefusal } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import type { ServerFieldTarget } from '../server-field-errors.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/products/{product}` — the resale item editor, drawn the way `Catalogue Forms.dc.html`
 * draws its siblings. The design has no resale frame of its own, so this is the ingredient editor's
 * page and the recipe editor's header, applied to what a resale record actually holds.
 *
 * ```
 * Burger patty (beef)  DRAFT  RSL-045       [ Archive ] [ Cancel ] [ Save draft ] [ Publish ]
 * ✖ 2 required  [ Item (EN) ] [ Packs ]   ⚠ 1 warning  [ Sales channels ]   <- once Save is pressed
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * Description ────────────────────────────────────────────────────────────────────────────────
 *   ┌╌╌╌╌╌╌┐  Item (EN)             Item (AR)
 *   ╎ (+)  ╎  Category              Produced from
 *   └╌╌╌╌╌╌┘  Description (EN)      Description (AR)
 * Packs ─────────────────────────────────────────────────────────────────── [ Add a pack ]
 *   Code      Label              Net qty  Unit   Per pack
 * Sale ───────────────────────────────────────────────────────────────────────────────────────
 *   One sold unit is  Unit        ☐ Market priced  ☐ Assorted / mixed box
 * Sales channels ─────────────────────────────────────────────────────────────────────────────
 *   ☑ Kiosk   ☐ POS   ☑ B2C …
 * Diet classifications   ⓘ From recipe ──────────────────────────────── [ Open the recipe ]
 *   ( Vegetarian ) ( High protein )
 * ```
 *
 * ## One page, not steps
 *
 * The ingredient and packaging editors are one page and the recipe editor is five numbered tabs.
 * A resale item sits with the first two: it is bought in, so it has no formulation, no cost
 * cascade and no technical sheet, and what is left fits on one page with every section open.
 * The steps this screen used to draw put the pack table behind a press, and that is where the
 * errors that stopped the save were.
 *
 * ## Save always answers
 *
 * The ingredient editor's rule, unchanged. Save can be pressed over an incomplete form, and
 * pressing it marks the form *attempted*: every required field still empty then says so under
 * itself, and the banner under the header names each one and takes the reader to it. A value typed
 * wrong — a duplicate pack code, a net content of `abc` — is flagged as it is typed, because the
 * reader has already typed it.
 *
 * The publication gate is the banner too. A record routed to no channel saves, because the channel
 * write is a separate call against a separate lock and refusing the record over it would trap a
 * valid record behind a second endpoint. It is still named, as a warning, because publishing waits
 * for it: an item on no channel is published where nobody can see it.
 *
 * ## One save, two writes, and the lock version rebases between them
 *
 * `updateProduct` carries the record's fields and the whole pack list; `setProductChannelAvailability`
 * carries the channels. That split is the contract's, and it is the right one: which routes to
 * market a product is sold through is a commercial act with its own audit entry server-side. But it
 * is not the reader's split. There is one Save, as on the recipe editor, and it writes whichever of
 * the two halves is dirty — the record first, then the channels at the lock version the record's
 * answer carries, the same way the recipe editor carries its version from one write to the next.
 * Only what changed is written: a save that re-sent untouched channels would put a false entry in
 * the log.
 *
 * ## The photo is a third write
 *
 * The photo has an endpoint of its own, as on the ingredient and recipe editors, and goes last —
 * after the record and the channels — because it needs the item's id and a refused upload must not
 * undo what is already saved (BUG-14). A photo-only change writes the photo alone.
 *
 * ## One thing this screen draws and does not keep
 *
 * **Diet classifications as a field.** `ProductAdmin.dietClassifications` is answered from the
 * linked recipe's published version. `UpdateProductRequest` nominally accepts them, but nothing
 * behind this contract stores a product-level override, so the section renders them with that
 * provenance — the allergen section's treatment on the ingredient editor — rather than as a form
 * whose value would silently vanish on reload.
 *
 * ## Embedded
 *
 * The same record is a cooked item's Selling tab in the recipe book (`RecipeBookEditScreen`), and
 * the listing under the notice of an item with no recipe yet (`CookedItemEditScreen`). There the
 * recipe is the page, so the header, the trail, Cancel, the photo, the category and the recipe
 * picker are the host's and are not drawn; what stays is this record's status, its own save and
 * publish, its banners and its sections.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

/**
 * The "bought in rather than cooked" answer of the recipe picker. Never a real identifier.
 *
 * ## Why this picker survives on a resale record
 *
 * A resale product is bought in and sold on, so on the face of it a formulation is a contradiction
 * and the control is dead weight. The data says otherwise, in two ways.
 *
 * `RSL-045 Burger Patty (beef)` is filed `production_mode: supplier` and carries a recipe link all
 * the same — a kitchen that buys patties in *and* knows how to make them. One row is enough:
 * removing the control would strand that link somewhere no screen could read or clear it, which is
 * the failure this codebase avoids everywhere else.
 *
 * And the link is load-bearing rather than decorative. `ProductAdmin.dietClassifications` is
 * answered from the linked recipe's published version, so clearing the picker silently empties a
 * section further down.
 *
 * The cooked kinds are a different question and have a different screen: a sauce or a dressing owns
 * its recipe outright and is edited in the recipe book (`RecipeBookEditScreen`), never here.
 */
const NO_RECIPE = '__none__';

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly categoryCode: string;
    readonly recipeId: RecipeId | null;
    readonly isMarketPriced: boolean;
    readonly isAssorted: boolean;
    /**
     * How much of its ingredient's shelf one sold unit is (PROD1) — `netContentQuantity` is the
     * person's own text while they type, parsed once on save.
     *
     * Every family on this screen sells from **finished stock** by type, so a row on a shelf counted
     * in kilograms has the same exposure a prepared salad does: without this pair the sale is
     * refused with `no_net_content` days later, on a customer's order.
     */
    readonly netContentQuantity: string;
    readonly netContentUnitId: string | null;
    readonly packs: readonly PackDraft[];
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    categoryCode: '',
    recipeId: null,
    isMarketPriced: false,
    isAssorted: false,
    netContentQuantity: '',
    netContentUnitId: null,
    packs: [],
};

function packsFrom(product: ProductAdmin): readonly PackDraft[] {
    return product.packVariants.map((pack, index) => ({
        key: `seed-${String(index)}-${pack.code}`,
        code: pack.code,
        label: pack.label,
        netQuantity: String(pack.netQuantity),
        netUnit: pack.netUnit,
        unitsPerPack: String(pack.unitsPerPack),
    }));
}

function detailsFrom(product: ProductAdmin): DetailsDraft {
    return {
        name: product.name,
        description: product.description,
        categoryCode: product.categoryCode,
        recipeId: product.recipeId,
        isMarketPriced: product.isMarketPriced,
        isAssorted: product.isAssorted,
        netContentQuantity: product.netContentQuantity ?? '',
        netContentUnitId: product.netContentUnitId,
        packs: packsFrom(product),
    };
}

function channelsFrom(product: ProductAdmin): readonly ChannelDraft[] {
    return product.channelAvailability.map((entry) => ({
        channel: entry.channel,
        isAvailable: entry.isAvailable,
        availableFrom: entry.availableFrom,
        availableUntil: entry.availableUntil,
    }));
}

/**
 * The editor's packs as the contract's payload. Called only once the row errors are empty.
 *
 * Trimmed and not upper-cased. A pack code is the identity a price list points at and the key the
 * server matches a submitted pack to its stored row by; a save that upper-cases it is a save that
 * renames every pack whose code was not already shouted — archiving the row a price quoted and
 * inserting a new one beside it. Duplicate detection is still case-insensitive (see
 * {@link packErrors}), because two codes that differ only in case are the same reference to a human.
 */
function packRequest(rows: readonly PackDraft[]): readonly ProductPackVariant[] {
    return rows.map((row) => ({
        code: row.code.trim(),
        label: row.label,
        netQuantity: parseQuantity(row.netQuantity) ?? 0,
        netUnit: row.netUnit,
        unitsPerPack: parseWholeNumber(row.unitsPerPack) ?? 1,
    }));
}

/** Something on the form that needs the reader, and the field that fixes it. */
interface FormIssue {
    readonly key: string;
    readonly label: string;
    readonly fieldId: string;
    /** A blank that only counts once Save is pressed, against a value already typed wrong. */
    readonly required: boolean;
}

const PACK_EDITOR_TEST_ID = 'kitchen-product-pack-editor';

/** The pack table's columns, in the order a row draws them. */
const PACK_COLUMNS: readonly PackColumn[] = ['code', 'label', 'quantity', 'unit', 'units-per-pack'];

/** What the server calls each column, under `variants.N.` — the row's place in the table. */
const PACK_SERVER_FIELD: Readonly<Record<PackColumn, string>> = {
    code: 'code',
    label: 'name_en',
    quantity: 'pack.pack_quantity',
    unit: 'pack.pack_unit_id',
    'units-per-pack': 'pack.pack_piece_count',
};

/** Each column's own label, as its header reads. */
const PACK_COLUMN_LABEL: Readonly<Record<PackColumn, string>> = {
    code: 'kitchen:products.packCodeLabel',
    label: 'kitchen:products.packLabel',
    quantity: 'kitchen:products.packQuantityLabel',
    unit: 'kitchen:products.packUnitLabel',
    'units-per-pack': 'kitchen:products.unitsPerPackLabel',
};

/** The anchor the `Packs` chip scrolls to: the table, while there is no row to focus. */
const PACKS_ANCHOR = 'kitchen-product-packs-anchor';

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface ProductEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly product: string | undefined;
    /**
     * Which packaged kind a create makes, and where the screen returns to. The recipe book passes a
     * cooked seller's kind and its own address when it embeds this as a Selling tab; the default is
     * products.
     */
    readonly itemType?: 'product' | 'sauce' | 'dressing' | 'frozen_meal';
    readonly routeBase?: '/kitchen/products' | '/kitchen/recipes';
    /**
     * Drawn as a cooked item's Selling tab rather than as a page — a sauce's or a dressing's listing,
     * on the page its recipe is.
     *
     * The recipe is the page the tab sits on, so the recipe picker is not drawn: which formulation a
     * sauce is made from is not a question its listing answers. Nor is the category, which the route
     * has already decided. Both keep their stored values through a save. There is no Cancel, because
     * the page has its own; and no create, because a cooked item's listing is written by the recipe's
     * first save.
     */
    readonly embedded?: boolean | undefined;
    /** Told when this listing's unsaved state changes, so a host page can guard its own exits. */
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
    /**
     * Hands this listing's save to the host page, whose one Save draft then writes it too (see
     * `host-save.ts`). With it the listing draws no Save of its own.
     */
    readonly onRegisterSave?: RegisterHostSave | undefined;
}

export function ProductEditScreen({
    product,
    itemType = 'product',
    routeBase = '/kitchen/products',
    embedded = false,
    onDirtyChange,
    onRegisterSave,
}: ProductEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-product-editor"
        >
            <ProductEditor
                product={product}
                itemType={itemType}
                routeBase={routeBase}
                embedded={embedded}
                onDirtyChange={onDirtyChange}
                onRegisterSave={onRegisterSave}
            />
        </Gate>
    );
}

function ProductEditor({
    product,
    itemType = 'product',
    routeBase = '/kitchen/products',
    embedded = false,
    onDirtyChange,
    onRegisterSave,
}: ProductEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = product === undefined || product === 'new';
    const parsed = isCreating ? null : ProductId.safeParse(product);

    const record = useProductQuery(parsed);
    const categories = useProductCategoriesQuery();
    const sellableChannels = useSellableChannelsQuery();
    const recipes = useAllRecipesQuery();

    /*
     * What the kitchen last paid for this item, read the way the ingredient editor reads it: the
     * shelf that *is* this product (`catalogueItemId`), then that shelf's newest priced receipt.
     * Shown, never typed — the next delivery posted moves it. A saved item only.
     */
    const formatter = useFormatter();
    const canViewCosts = useCan(INVENTORY_VIEW_COSTS_PERMISSION);
    const stockItems = useStockItemsQuery(!isCreating && canViewCosts);
    const stockItemId = useMemo(() => {
        if (parsed === null) return null;
        const shelf = stockItems.data?.find(
            (item) =>
                item.catalogueItemId !== null && String(item.catalogueItemId) === String(parsed),
        );
        return shelf === undefined ? null : shelf.id;
    }, [stockItems.data, parsed]);
    const latestPurchaseIds = useMemo(
        () => (stockItemId === null ? [] : [stockItemId]),
        [stockItemId],
    );
    const latestPurchases = useItemLatestPurchasesQuery(latestPurchaseIds, canViewCosts);
    const latestPurchase = latestPurchases.data?.[0] ?? null;
    /* Never a zero in the empty case: an unbought item and a free one are different facts. */
    const lastPriceValue =
        latestPurchase === null || latestPurchase.unitPriceAmount === null
            ? ''
            : formatter.formatNumber(Number(latestPurchase.unitPriceAmount), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
              });
    /* A shelf-less item has nothing to wait for — its purchase query never runs. */
    const lastPricePlaceholder =
        stockItems.isPending || (stockItemId !== null && latestPurchases.isPending)
            ? t('kitchen:ops.stock.lastPurchaseLoading')
            : t('kitchen:ops.stock.neverBought');
    const lastPriceSupplier =
        latestPurchase === null || latestPurchase.supplier === null
            ? t('kitchen:ops.stock.noPurchaseSupplier')
            : latestPurchase.supplier.nameEn;
    const lastPriceSource =
        latestPurchase === null
            ? undefined
            : latestPurchase.receivedAt === null
              ? lastPriceSupplier
              : t('kitchen:ops.stock.lastPurchaseFrom', {
                    supplier: lastPriceSupplier,
                    date: formatter.formatDate(latestPurchase.receivedAt, { dateStyle: 'medium' }),
                });

    const create = useCreateProductMutation();
    const update = useUpdateProductMutation();
    const setChannels = useSetProductChannelAvailabilityMutation();
    const publish = usePublishProductMutation();
    const archive = useArchiveProductMutation();
    const photoSave = useSaveRecordPhotoMutation();
    /*
     * B2B and B2C on a new item: held here and written once the item exists, after its routes to
     * market (that write takes the version the create left, and this one reads the newest).
     */
    const [channelPriceDraft, setChannelPriceDraft] =
        useState<ChannelPriceDraft>(EMPTY_CHANNEL_PRICE_DRAFT);
    const writeChannelPriceDraft = useWriteChannelPriceDraft();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    /*
     * Cancel and the not-found page's way out go back a step, as the browser's arrow does — to the
     * list as it was left — and open the list afresh only when nothing is behind this page.
     */
    const back = useReturnTo(undefined, routeBase);

    useEffect(() => {
        onDirtyChange?.(guard.isDirty);
    }, [guard.isDirty, onDirtyChange]);

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [channels, setChannelRows] = useState<readonly ChannelDraft[]>([]);
    const [channelsKey, setChannelsKey] = useState<string | null>(null);
    const [channelsDirty, setChannelsDirty] = useState(false);

    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);
    /*
     * The photo, the link it was last filled from (`undefined` until the record arrives), and
     * whether it has been changed since. Rehydrated on its own key: the photo endpoint moves the
     * link and not the lock version.
     */
    const [photo, setPhoto] = useState<string | null>(null);
    const [photoKey, setPhotoKey] = useState<string | null | undefined>(undefined);
    const [photoDirty, setPhotoDirty] = useState(false);

    const [nextPackOrdinal, setNextPackOrdinal] = useState(1);
    const [showPublish, setShowPublish] = useState(false);
    const [showArchive, setShowArchive] = useState(false);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's values still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== channelsKey && !channelsDirty) {
        setChannelsKey(serverKey);
        setChannelRows(channelsFrom(data));
    }
    if (data !== undefined && (data.photoUrl ?? null) !== photoKey && !photoDirty) {
        setPhotoKey(data.photoUrl ?? null);
        setPhoto(data.photoUrl ?? null);
    }

    const title = isCreating
        ? t('kitchen:products.createTitle')
        : displayName(details.name, locale).value || t('kitchen:products.editTitle');

    /*
     * The trail's last crumb, which is what makes `Resale` above it a link back to the list. Not
     * embedded: the host page names itself. Not while a record is still loading either, because
     * there is nothing truthful to put in it for the frame or two before it arrives.
     */
    useKitchenTrailLeaf(!embedded && (isCreating || data !== undefined) ? title : null);

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    const markChannelsDirty = () => {
        setChannelsDirty(true);
        guard.markDirty();
    };

    const settle = (nextDetailsDirty: boolean, nextChannelsDirty: boolean) => {
        setDetailsDirty(nextDetailsDirty);
        setChannelsDirty(nextChannelsDirty);
        if (!nextDetailsDirty && !nextChannelsDirty) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setChannelsDirty(false);
        setDetailsKey(null);
        setChannelsKey(null);
        setPhotoDirty(false);
        setPhotoKey(undefined);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const takePackKey = (): string => {
        const key = `pack-${String(nextPackOrdinal)}`;
        setNextPackOrdinal(nextPackOrdinal + 1);
        return key;
    };

    /** One field of the draft, and the dirty flag with it — the shape every input below writes. */
    const edit = (patch: Partial<DetailsDraft>) => {
        setDetails({ ...details, ...patch });
        markDetailsDirty();
    };

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    const categoryOptions: readonly SelectOption[] = useMemo(() => {
        const known = new Map<string, SelectOption>();
        for (const entry of categories.data ?? []) {
            known.set(entry.code, { value: entry.code, label: humaniseCode(entry.code) });
        }
        if (details.categoryCode !== '' && !known.has(details.categoryCode)) {
            known.set(details.categoryCode, {
                value: details.categoryCode,
                label: humaniseCode(details.categoryCode),
            });
        }
        return [...known.values()].sort((left, right) => left.label.localeCompare(right.label));
    }, [categories.data, details.categoryCode]);

    /**
     * The picked category's id — what the write files the item under (HA-31). `undefined` when the
     * vocabulary does not know the code, so a save never clears a category it could not resolve.
     */
    const pickedCategory = (categories.data ?? []).find(
        (entry) => entry.code === details.categoryCode,
    );
    const categoryIdRequest = pickedCategory === undefined ? {} : { categoryId: pickedCategory.id };

    /** `NO_RECIPE` is the "bought in rather than cooked" answer, and never a real identifier. */
    const recipeRows = recipesFromPages(recipes.data?.pages);
    const recipeOptions: readonly SelectOption[] = useMemo(
        () => [
            { value: NO_RECIPE, label: t('kitchen:products.recipeNone') },
            ...recipeRows.map((row) => ({
                value: String(row.id),
                label: displayName(row.name, locale).value,
                // Searched, not shown — see `SelectOption.keywords`.
                keywords: row.slug,
            })),
        ],
        [recipeRows, locale, t],
    );

    /*
     * Net content is stated against a measurement unit **identifier**, and the only read carrying
     * one is the goods-receipt reference — `useUnitOptions` in `catalogue-row-editors.tsx` builds
     * its options from `MeasureUnit` *codes*, which is what a pack variant stores and is not what
     * this column holds. That read is behind `inventory.view_organisation`, so a catalogue-only
     * role cannot fill the pair in and is told so rather than shown an empty picker.
     */
    const canReadUnits = useCan(INVENTORY_VIEW_PERMISSION);
    const reference = useProcurementReferenceQuery(canReadUnits);
    const referenceUnits: readonly MeasurementUnitOption[] | undefined =
        reference.data?.measurementUnits;
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            // The admin's Kg, L, Pc — not every row the server holds (kcal, cm, mg…) — plus the one
            // already chosen, if it is something else.
            adminReferenceUnits(referenceUnits ?? [], details.netContentUnitId).map((unit) => ({
                value: unit.id,
                label: unitCodeLabel(unit.code, t),
                description: unit.nameEn,
            })),
        [referenceUnits, details.netContentUnitId, t],
    );

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const packRowErrors = useMemo(
        () =>
            packErrors(details.packs, {
                codeRequired: t('kitchen:products.packCodeRequired'),
                codeDuplicate: t('kitchen:products.packCodeDuplicate'),
                quantityInvalid: t('kitchen:products.packQuantityInvalid'),
                unitsInvalid: t('kitchen:products.unitsPerPackInvalid'),
            }),
        [details.packs, t],
    );

    const nameMissing = details.name.en.trim() === '';
    // Embedded, the route has decided the category and the field is not drawn.
    const categoryMissing = !embedded && details.categoryCode.trim() === '';
    const packsMissing = details.packs.length === 0;

    /*
     * A pack row still waiting on its code is a blank, and waits for Save like any other; a row
     * whose code, quantity or count is typed wrong is flagged at once.
     */
    const blankPackKeys = new Set(
        details.packs.filter((row) => row.code.trim() === '').map((row) => row.key),
    );
    const firstPackError = details.packs.find((row) => packRowErrors.has(row.key));
    // The field the banner's chip focuses: the first wrong column of that row, not always its code.
    const firstPackErrorField =
        firstPackError === undefined
            ? undefined
            : `${PACK_EDITOR_TEST_ID}-row-${firstPackError.key}-${
                  firstPackErrorColumn(packRowErrors.get(firstPackError.key) ?? {}) ?? 'code'
              }`;

    /*
     * Net content is all-or-nothing, and that is all this screen can check.
     *
     * The meal editor also knows whether the shelf behind the item is counted by weight — it picks
     * the produced ingredient itself, so it holds the unit. `ProductAdmin` carries no
     * `ingredientId`, so there is no shelf to ask here, and guessing would either block a legal save
     * or promise one the server refuses. So the pair is offered as optional and
     * `CatalogueItemService::requireNetContentOnAWeighedShelf()` stays the authority on when it is
     * compulsory — its refusal names this field.
     */
    const netContentText = details.netContentQuantity.trim();
    const netContent = netContentText === '' ? null : parseQuantity(netContentText);
    const netContentInvalid = netContentText !== '' && (netContent === null || netContent <= 0);
    const netContentUnitMissing = netContentText !== '' && details.netContentUnitId === null;

    /*
     * Everything that stops the save, in the order the fields appear. The banner reads this list;
     * the fields read the same flags, so the two cannot disagree about what is wrong.
     */
    const blockers: readonly FormIssue[] = [
        ...(nameMissing
            ? [
                  {
                      key: 'name',
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:list.columnItem'),
                      }),
                      fieldId: 'kitchen-product-name-en',
                      required: true,
                  },
              ]
            : []),
        ...(categoryMissing
            ? [
                  {
                      key: 'category',
                      label: t('kitchen:fields.category'),
                      fieldId: 'kitchen-product-category',
                      required: true,
                  },
              ]
            : []),
        ...(packsMissing
            ? [
                  {
                      key: 'packs',
                      label: t('kitchen:products.sectionPacks'),
                      fieldId: PACKS_ANCHOR,
                      required: true,
                  },
              ]
            : firstPackErrorField === undefined
              ? []
              : [
                    {
                        key: 'packs',
                        label: t('kitchen:products.sectionPacks'),
                        fieldId: firstPackErrorField,
                        // Only a row still waiting on its code is a blank; anything else was typed.
                        required: [...packRowErrors.keys()].every((key) => blankPackKeys.has(key)),
                    },
                ]),
        ...(netContentInvalid
            ? [
                  {
                      key: 'net-content',
                      label: t('kitchen:products.netContentLabel'),
                      fieldId: 'kitchen-product-net-content',
                      required: false,
                  },
              ]
            : []),
        ...(netContentUnitMissing
            ? [
                  {
                      key: 'net-content-unit',
                      label: t('kitchen:products.netContentUnitLabel'),
                      fieldId: 'kitchen-product-net-content-unit',
                      required: true,
                  },
              ]
            : []),
    ];

    /*
     * The same list as the reader sees it: before the first Save, only what has already been typed
     * wrong; after it, everything.
     */
    const shownBlockers = attempted ? blockers : blockers.filter((entry) => !entry.required);
    const shows = (key: string): boolean => shownBlockers.some((entry) => entry.key === key);

    /*
     * The pack table's own messages, on the same schedule: a blank row's `code required` waits for
     * Save, a duplicate does not.
     */
    const shownPackErrors: ReadonlyMap<string, PackRowErrors> = attempted
        ? packRowErrors
        : new Map([...packRowErrors].filter(([key]) => !blankPackKeys.has(key)));

    /*
     * The one warning: a record routed to no channel. It never blocks the save — see the module
     * note — but it does block publication, so an existing record says so from the start. A new one
     * waits for Save, like every other blank on a form nobody has filled in yet.
     */
    const noChannel = !channels.some((row) => row.isAvailable);
    const warnings: readonly FormIssue[] =
        noChannel && (attempted || !isCreating)
            ? [
                  {
                      key: 'channels',
                      label: t('kitchen:channels.sectionTitle'),
                      // The first box the editor draws, in the enum's own order.
                      fieldId: `kitchen-product-channel-editor-${SALES_CHANNELS[0]}-toggle`,
                      required: false,
                  },
              ]
            : [];

    const issueItems = (entries: readonly FormIssue[]): readonly FormIssueItem[] =>
        entries.map((entry) => ({
            key: entry.key,
            label: entry.label,
            /*
             * The chip names the field, and the field still says what is wrong under itself. Not
             * `Packs`: that one chip covers the whole table, and each row's own message is what
             * says which column — and which row — is wrong.
             */
            fieldId: entry.key === 'packs' ? undefined : entry.fieldId,
            onPress: () => {
                focusField(entry.fieldId);
            },
        }));
    const blockerItems = issueItems(shownBlockers);
    const warningItems = issueItems(warnings);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /**
     * The net-content pair as a request fragment, shared by the create and update branches.
     *
     * Sent on every save, `null` included: a cleared net content is a real answer, and a row taken
     * off a weighed shelf must be able to drop it. A half-typed pair goes as neither — the same
     * all-or-nothing the column's own CHECK states, said before the round trip rather than after.
     */
    const netContentRequest = {
        netContentQuantity:
            netContent === null || details.netContentUnitId === null ? null : netContent,
        netContentUnitId: netContent === null ? null : details.netContentUnitId,
    };

    /**
     * The channel write, at whatever lock version the previous write left the record on.
     *
     * `wroteRecord` says whether the record write went first in this same save: if it did and this
     * one is refused, the record *is* saved, and only the channels are left to try again.
     */
    /**
     * The photo, written last: it needs the item's id, and a refused upload must not undo what is
     * already saved. Answers the failure, or null. An untouched slot is a no-op, so every save
     * calls it.
     */
    const writePhoto = async (
        productId: ProductId,
        saved: string | null | undefined,
    ): Promise<unknown> => {
        try {
            await photoSave.mutateAsync({
                subject: 'catalogue_item',
                recordId: String(productId),
                chosen: photo,
                saved,
            });
            setPhotoDirty(false);
            return null;
        } catch (error) {
            return error;
        }
    };

    /**
     * After the record's writes: the photo, then the dirty flags and the toast. A refused photo
     * keeps the guard armed — the record is saved, and only the photo is left to try again.
     */
    const finishWithPhoto = (productId: ProductId, onSaved: () => void) => {
        void writePhoto(productId, data?.photoUrl).then((photoError) => {
            settle(false, false);
            if (photoError === null) {
                onSaved();
                return;
            }
            guard.markDirty();
        });
    };

    /*
     * What the server can refuse, by its field name, and where that field is on this page — in the
     * order the page draws them, so a refused save takes the reader to the first one (BUG-06).
     * `packs` is the pack table's part: one wildcard per column for the banner, which names the
     * table once, or one entry per cell for the jump, which lands in the cell itself. The rows go
     * out in the order the table draws them, so `variants.2.…` is the third row.
     */
    const fieldTargets = (
        packs: Readonly<Record<string, ServerFieldTarget>>,
    ): Readonly<Record<string, ServerFieldTarget>> => ({
        name_en: {
            label: t('kitchen:bilingual.englishShort', { field: t('kitchen:list.columnItem') }),
            fieldId: 'kitchen-product-name-en',
        },
        name_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: t('kitchen:list.columnItem') }),
            fieldId: 'kitchen-product-name-ar',
        },
        // Embedded, neither picker is drawn, so a refusal of either stays in the callout.
        ...(embedded
            ? {}
            : {
                  product_category_id: {
                      label: t('kitchen:fields.category'),
                      fieldId: 'kitchen-product-category',
                  },
                  recipe_id: {
                      label: t('kitchen:products.recipeLabel'),
                      fieldId: 'kitchen-product-recipe-select',
                  },
              }),
        description_en: {
            label: t('kitchen:bilingual.englishShort', {
                field: t('kitchen:products.descriptionLabel'),
            }),
            fieldId: 'kitchen-product-description-en',
        },
        description_ar: {
            label: t('kitchen:bilingual.arabicShort', {
                field: t('kitchen:products.descriptionLabel'),
            }),
            fieldId: 'kitchen-product-description-ar',
        },
        variants: { label: t('kitchen:products.sectionPacks'), fieldId: PACKS_ANCHOR },
        ...packs,
        ...(canReadUnits
            ? {
                  net_content_quantity: {
                      label: t('kitchen:products.netContentLabel'),
                      fieldId: 'kitchen-product-net-content',
                  },
                  net_content_unit_id: {
                      label: t('kitchen:products.netContentUnitLabel'),
                      fieldId: 'kitchen-product-net-content-unit',
                  },
              }
            : {}),
        is_market_priced: {
            label: t('kitchen:products.marketPricedShort'),
            fieldId: 'kitchen-product-market-priced',
        },
        is_assorted: {
            label: t('kitchen:products.assortedShort'),
            fieldId: 'kitchen-product-assorted',
        },
    });
    const serverTargets = fieldTargets(
        Object.fromEntries(
            PACK_COLUMNS.map((column) => [
                `variants.*.${PACK_SERVER_FIELD[column]}`,
                { label: t(PACK_COLUMN_LABEL[column]), fieldId: PACKS_ANCHOR },
            ]),
        ),
    );
    /** After a refusal: the first field the server named, a pack's own cell included. */
    const focusRefusal = (error: unknown) => {
        focusFirstRefusal(
            error,
            fieldTargets(
                Object.fromEntries(
                    details.packs.flatMap((row, index) =>
                        PACK_COLUMNS.map((column) => [
                            `variants.${String(index)}.${PACK_SERVER_FIELD[column]}`,
                            {
                                label: t(PACK_COLUMN_LABEL[column]),
                                fieldId: `${PACK_EDITOR_TEST_ID}-row-${row.key}-${column}`,
                            },
                        ]),
                    ),
                ),
            ),
        );
    };

    const showSaved = () => {
        toast.show({
            testID: 'kitchen-product-saved-toast',
            tone: 'success',
            message: t('kitchen:editor.savedToast'),
        });
    };

    const writeChannels = (productId: ProductId, lockVersion: number, wroteRecord: boolean) => {
        setChannels.mutate(
            {
                productId,
                request: { lockVersion, availability: channelRequest(channels) },
            },
            {
                onSuccess: () => {
                    finishWithPhoto(productId, () => {
                        if (wroteRecord) {
                            showSaved();
                            return;
                        }
                        toast.show({
                            testID: 'kitchen-product-channels-saved-toast',
                            tone: 'success',
                            message: t('kitchen:channels.savedToast'),
                        });
                    });
                },
                onError: (error) => {
                    if (wroteRecord) settle(false, true);
                    concurrency.capture(error);
                },
            },
        );
    };

    /** The record write, at `lockVersion` — one body for this page's Save and the host's. */
    const updateRequest = (saved: ProductAdmin, lockVersion: number) => ({
        lockVersion,
        name: details.name,
        description: details.description,
        categoryCode: details.categoryCode,
        // Only a category the reader moved: re-sending the one the record opened on would be a
        // write about nothing.
        ...(details.categoryCode === saved.categoryCode ? {} : categoryIdRequest),
        recipeId: details.recipeId,
        isMarketPriced: details.isMarketPriced,
        isAssorted: details.isAssorted,
        packVariants: packRequest(details.packs),
        ...netContentRequest,
    });

    /*
     * The host's save (see `host-save.ts`): the same writes as Save draft, in the same order —
     * the record, then the routes at the version it answered with, then the photo — awaited, so
     * the recipe can say once that everything saved. A blocked or refused write answers `false`
     * with the reason on its field, exactly where this page's own Save would have put it.
     */
    useHostSave(onRegisterSave, async () => {
        if (data === undefined || !guard.isDirty) return true;
        setAttempted(true);
        if (!canManage || blockers.length > 0) return false;
        try {
            let lockVersion = data.meta.lockVersion;
            if (detailsDirty) {
                const updated = await update.mutateAsync({
                    productId: data.id,
                    request: updateRequest(data, lockVersion),
                });
                lockVersion = updated.meta.lockVersion;
            }
            if (channelsDirty) {
                await setChannels.mutateAsync({
                    productId: data.id,
                    request: { lockVersion, availability: channelRequest(channels) },
                });
            }
        } catch (error) {
            if (!concurrency.capture(error)) focusRefusal(error);
            return false;
        }
        const photoError = await writePhoto(data.id, data.photoUrl);
        settle(false, false);
        if (photoError !== null) {
            guard.markDirty();
            return false;
        }
        return true;
    });

    const save = () => {
        if (!canManage) return;
        setAttempted(true);
        if (blockers.length > 0) {
            // The banner names every field; the first one is also where the reader is taken.
            focusField(blockers[0]!.fieldId);
            return;
        }

        if (isCreating) {
            // A bad B2B/B2C row says so under the row (the section reads `attempted`).
            if (!channelPriceDraftValid(channelPriceDraft)) return;
            create.mutate(
                {
                    name: details.name,
                    description: details.description,
                    categoryCode: details.categoryCode,
                    ...categoryIdRequest,
                    itemType,
                    isMarketPriced: details.isMarketPriced,
                    isAssorted: details.isAssorted,
                    packVariants: packRequest(details.packs),
                    ...(details.recipeId === null ? {} : { recipeId: details.recipeId }),
                    ...netContentRequest,
                },
                {
                    onSuccess: async (created) => {
                        const photoError = await writePhoto(created.id, null);
                        toast.show({
                            testID: 'kitchen-product-created-toast',
                            tone: 'success',
                            message: t('kitchen:products.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        // The page is about to leave, so a refused photo is said in a toast rather
                        // than the save callout, which would go with it.
                        if (photoError !== null) {
                            toast.show({
                                tone: 'danger',
                                message:
                                    toFailure(photoError)?.message ?? t('kitchen:editor.saveError'),
                            });
                            photoSave.reset();
                        }

                        const open = () => {
                            void writeChannelPriceDraft(created.id, channelPriceDraft).then(
                                (prices) => {
                                    // Leaving the page, so a refusal is a toast, as the photo's is.
                                    if (prices.error !== null) {
                                        toast.show({
                                            tone: 'danger',
                                            message: t('kitchen:channelPrices.failed'),
                                        });
                                    }
                                    for (const channel of prices.unavailable) {
                                        toast.show({
                                            tone: 'warning',
                                            message: t('kitchen:channelPrices.noPriceList', {
                                                channel: t(`kitchen:channelPrices.${channel}`),
                                            }),
                                        });
                                    }
                                    settle(false, false);
                                    router.replace(`${routeBase}/${String(created.id)}` as never);
                                },
                            );
                        };

                        /*
                         * Routes to market can be ticked before the product exists, so they arrive
                         * here with nowhere to have been written yet - the channels endpoint takes
                         * a product id. This is the first moment there is one.
                         *
                         * `onSettled`, not `onSuccess`: the record itself is saved either way, and
                         * stranding somebody on a create form for a record that already exists is
                         * worse than landing them on it with the banner saying the routes are unset.
                         */
                        if (noChannel) {
                            open();
                            return;
                        }

                        setChannels.mutate(
                            {
                                productId: created.id,
                                request: {
                                    lockVersion: created.meta.lockVersion,
                                    availability: channelRequest(channels),
                                },
                            },
                            { onSettled: open },
                        );
                    },
                    onError: focusRefusal,
                },
            );
            return;
        }

        if (data === undefined) return;

        // Only the channels changed: the record write would be an audited act that changed nothing.
        if (!detailsDirty && channelsDirty) {
            writeChannels(data.id, data.meta.lockVersion, false);
            return;
        }
        // Only the photo changed: the same reasoning, so the photo is the one write.
        if (!detailsDirty && photoDirty) {
            finishWithPhoto(data.id, showSaved);
            return;
        }

        update.mutate(
            { productId: data.id, request: updateRequest(data, data.meta.lockVersion) },
            {
                onSuccess: (updated) => {
                    // The channels go second, at the version the record's answer carries.
                    if (channelsDirty) {
                        writeChannels(updated.id, updated.meta.lockVersion, true);
                        return;
                    }
                    finishWithPhoto(updated.id, showSaved);
                },
                onError: (error) => {
                    if (!concurrency.capture(error)) focusRefusal(error);
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
            <Stack space="md" testID="kitchen-product-editor-screen">
                <Callout
                    testID="kitchen-product-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:products.notFoundTitle')}
                    actions={
                        <Button
                            testID="kitchen-product-not-found-back"
                            variant="quiet"
                            size="sm"
                            label={t('kitchen:products.backToList')}
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
                testID="kitchen-product-editor-loading"
                partTestID="kitchen-product"
                sections={3}
            />
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="md" testID="kitchen-product-editor-screen">
                <ErrorState
                    testID="kitchen-product-load-error"
                    failure={loadFailure}
                    title={t('kitchen:products.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    // What the server refused, put on the fields it named (BUG-06).
    const server = serverFieldErrors(saveFailure, serverTargets);
    const packFieldError = (row: PackDraft, column: PackColumn): string | undefined => {
        const index = details.packs.findIndex((entry) => entry.key === row.key);
        return index < 0
            ? undefined
            : server.errorFor(`variants.${String(index)}.${PACK_SERVER_FIELD[column]}`);
    };
    const dangerItems: readonly FormIssueItem[] = [...blockerItems, ...server.items];
    const channelFailure = toFailure(setChannels.error);
    const status = data?.meta.status ?? 'draft';
    const quarantined = status === 'review_required';
    const photoFailure = toFailure(photoSave.error);
    /*
     * A refused publish or archive, other than a lock conflict — which opens its own dialog. The
     * dialog that asked has closed by then, so the page says it rather than nothing at all.
     */
    const actFailure = (error: unknown) => {
        const failure = toFailure(error);
        return failure === null || failure.code === 'resource.conflict' ? null : failure;
    };
    const publishFailure = actFailure(publish.error);
    const archiveFailure = actFailure(archive.error);
    const busy =
        create.isPending || update.isPending || setChannels.isPending || photoSave.isPending;

    /*
     * The client-side half of the publish gate: everything that stops the save, the one warning,
     * and an unsaved edit — because publish sends a lock version and publishes what the *server*
     * holds, not what is on screen. `CatalogueItemReadiness` on the server is still the authority
     * and refuses more than this; these are only the ones a person can see and fix from this form.
     */
    /*
     * A sale of this item would take nothing off a shelf (HA-45) — a weighed shelf with no pack
     * weight or net content. Not a save blocker: the fix is made on this form and saved first. The
     * server refuses the publication on the same codes; this says why before anyone presses it.
     */
    const stockBlockers = data?.stockBlockers ?? [];
    const stockBlockedHint =
        stockBlockers.length === 0
            ? undefined
            : stockBlockersSentence(stockBlockers, 'publishBlocked', t);
    const publishBlocked =
        stockBlockers.length > 0 ||
        blockers.length > 0 ||
        noChannel ||
        detailsDirty ||
        channelsDirty ||
        photoDirty ||
        quarantined;
    const offersPublish =
        !isCreating && canManage && status !== 'published' && status !== 'retired';
    /*
     * Archive is always drawn, and says on hover why it cannot be pressed when it cannot. A button
     * that appears only once it works leaves a new record's header missing a control the reader
     * then has to discover later; a disabled one with its reason says where the act lives and what
     * it is waiting for. The reasons in the order they apply: nobody without the permission can
     * archive anything, a record that does not exist yet has nothing to archive, and an archived
     * one is already there.
     */
    const archiveBlockedKey = !canManage
        ? 'kitchen:products.archiveNoPermission'
        : isCreating
          ? 'kitchen:products.archiveUnsaved'
          : status === 'retired'
            ? 'kitchen:products.archiveAlready'
            : null;

    const openRecipe = () => {
        const target = details.recipeId;
        if (target === null) return;
        guard.intercept(() => {
            router.push(`/kitchen/recipes/${String(target)}` as never);
        });
    };

    /* ── the opening ─────────────────────────────────────────────────────────────────────────── */

    const statusBadge = (
        <Badge
            variant="caps"
            testID="kitchen-product-editor-screen-status"
            tone={statusTone(status)}
            icon={null}
            label={t(statusKey(status))}
        />
    );

    const dirtyBadge = guard.isDirty ? (
        <Badge
            variant="label"
            testID="kitchen-product-editor-screen-dirty"
            tone="warning"
            icon="warning"
            label={t('kitchen:editor.unsaved')}
        />
    ) : null;

    /*
     * Archive · Cancel · Save draft · Publish. Archive leads and is quiet: it is the one act here
     * that takes the record off sale, and it should not sit where a hand reaching for Save lands.
     * Save draft carries the primary's weight until there is something to publish, as on the recipe
     * editor.
     */
    const actions = (
        <Inline space="xs" align="center" wrap justify="end">
            <Button
                testID="kitchen-product-archive"
                variant="quiet"
                label={t('kitchen:list.archive')}
                disabled={archiveBlockedKey !== null}
                hint={t(archiveBlockedKey ?? 'kitchen:products.archiveHint')}
                onPress={() => {
                    setShowArchive(true);
                }}
            />
            {embedded ? null : (
                <Button
                    testID="kitchen-product-editor-screen-back"
                    variant="secondary"
                    label={t('kitchen:editor.cancel')}
                    onPress={() => {
                        guard.intercept(goBack);
                    }}
                />
            )}
            {/* Saved by the host page's own Save when it took this listing's (`host-save.ts`). */}
            {onRegisterSave !== undefined ? null : (
                <Button
                    testID="kitchen-product-editor-screen-save"
                    variant={offersPublish ? 'secondary' : 'primary'}
                    label={t('kitchen:common.saveDraft')}
                    loading={busy}
                    disabled={!canManage || busy}
                    onPress={save}
                />
            )}
            {offersPublish ? (
                <Button
                    testID="kitchen-product-publish"
                    label={t('kitchen:publish.action')}
                    // Visibly disabled while anything this screen can check fails; the dialog's
                    // confirm keeps the same guard, and the server keeps the real one.
                    disabled={publishBlocked}
                    hint={stockBlockedHint}
                    onPress={() => {
                        setShowPublish(true);
                    }}
                />
            ) : null}
        </Inline>
    );

    const identityFields = (
        <FormGrid track="half" maxColumns={4} testID="kitchen-product-identity-grid">
            {/*
             * One `BilingualField` rather than two inputs, because that component owns the
             * per-language writing direction; `row` puts the halves side by side inside the four
             * tracks `span={4}` claims.
             */}
            <BilingualField
                span={4}
                layout="row"
                testID="kitchen-product-name"
                fieldLabel={t('kitchen:list.columnItem')}
                placeholder={{
                    en: t('kitchen:fields.productNamePlaceholderEn'),
                    ar: t('kitchen:fields.productNamePlaceholderAr'),
                }}
                value={details.name}
                requiredEnglish
                disabled={!canManage}
                {...(shows('name')
                    ? { englishError: t('kitchen:forms.required') }
                    : server.errorFor('name_en') === undefined
                      ? {}
                      : { englishError: server.errorFor('name_en') })}
                {...(server.errorFor('name_ar') === undefined
                    ? {}
                    : { arabicError: server.errorFor('name_ar') })}
                onChange={(next) => {
                    edit({ name: next });
                }}
            />

            {/*
             * "What is it filed under" and "where does it come from" are asked of a new resale item
             * in the same breath, so they share a row. Neither is drawn embedded: the route decides
             * the category and the page the tab sits on is the recipe.
             */}
            {embedded ? null : (
                <Select
                    span={2}
                    testID="kitchen-product-category"
                    id="kitchen-product-category"
                    label={t('kitchen:fields.category')}
                    placeholder={t('kitchen:fields.categoryPlaceholder')}
                    searchable
                    required
                    disabled={!canManage}
                    options={categoryOptions}
                    value={details.categoryCode === '' ? null : details.categoryCode}
                    {...(shows('category') ? { error: t('kitchen:forms.required') } : {})}
                    {...server.flag('product_category_id')}
                    onChange={(next) => {
                        edit({ categoryCode: next });
                    }}
                />
            )}
            {embedded ? null : (
                <Select
                    span={2}
                    testID="kitchen-product-recipe-select"
                    id="kitchen-product-recipe-select"
                    label={t('kitchen:products.recipeLabel')}
                    placeholder={t('kitchen:products.recipePlaceholder')}
                    searchable
                    disabled={!canManage}
                    options={recipeOptions}
                    value={details.recipeId === null ? NO_RECIPE : String(details.recipeId)}
                    {...server.flag('recipe_id')}
                    onChange={(next) => {
                        edit({ recipeId: next === NO_RECIPE ? null : (next as RecipeId) });
                    }}
                />
            )}

            <BilingualField
                span={4}
                layout="row"
                multiline
                testID="kitchen-product-description"
                fieldLabel={t('kitchen:products.descriptionLabel')}
                placeholder={{
                    en: t('kitchen:fields.descriptionPlaceholderEn'),
                    ar: t('kitchen:fields.descriptionPlaceholderAr'),
                }}
                value={details.description}
                disabled={!canManage}
                {...(server.errorFor('description_en') === undefined
                    ? {}
                    : { englishError: server.errorFor('description_en') })}
                {...(server.errorFor('description_ar') === undefined
                    ? {}
                    : { arabicError: server.errorFor('description_ar') })}
                onChange={(next) => {
                    edit({ description: next });
                }}
            />
        </FormGrid>
    );

    /*
     * The page arrives in bands, each rising in behind the one above it. Embedded, this listing is
     * a tab of its host's page rather than a page, so it lays its parts out flat and arrives however
     * the host does — never twice.
     */
    const Page = embedded ? Stack : Cascade;

    /*
     * The page's notices, one band under the opening rather than a band each: a title on a line
     * per notice. What went wrong keeps the server's own words, because those are the message; a
     * notice that only explains is its title alone.
     */
    const notices = [
        /*
         * A quarantine is rendered, never resolved from here: `review_required` blocks publication
         * structurally (plan §4.7) and is cleared by fixing the allergen determination it came
         * from, on the ingredient.
         */
        quarantined ? (
            <Callout
                key="quarantine"
                testID="kitchen-product-quarantine"
                role="alert"
                tone="warning"
                title={t('kitchen:products.quarantineTitle')}
            />
        ) : null,
        data === undefined || data.dataQualityFlags.length === 0 ? null : (
            <Callout
                key="data-quality"
                testID="kitchen-product-data-quality"
                role="note"
                tone="warning"
                title={t('kitchen:products.dataQualityTitle')}
            >
                <Inline space="xs" wrap>
                    {data.dataQualityFlags.map((flag) => (
                        <Badge
                            key={flag}
                            variant="label"
                            testID={`kitchen-product-flag-${flag}`}
                            tone="warning"
                            label={humaniseCode(flag)}
                        />
                    ))}
                </Inline>
            </Callout>
        ),
        saveFailure === null || (server.isValidation && server.unplaced === null) ? null : (
            <Callout
                key="save-error"
                testID="kitchen-product-save-error"
                role="alert"
                tone="danger"
                title={t('kitchen:editor.saveError')}
                body={server.unplaced ?? saveFailure.message}
            />
        ),
        channelFailure === null ? null : (
            <Callout
                key="channels-error"
                testID="kitchen-product-channels-error"
                role="alert"
                tone="danger"
                title={t('kitchen:channels.saveError')}
                body={channelFailure.message}
            />
        ),
        photoFailure === null ? null : (
            <Callout
                key="photo-error"
                testID="kitchen-product-photo-error"
                role="alert"
                tone="danger"
                title={t('kitchen:editor.saveError')}
                body={photoFailure.message}
            />
        ),
        publishFailure === null ? null : (
            <Callout
                key="publish-error"
                testID="kitchen-product-publish-error"
                role="alert"
                tone="danger"
                title={t('kitchen:publish.failedTitle')}
                body={publishFailure.message}
            />
        ),
        archiveFailure === null ? null : (
            <Callout
                key="archive-error"
                testID="kitchen-product-archive-error"
                role="alert"
                tone="danger"
                title={t('kitchen:products.archiveFailed')}
                body={archiveFailure.message}
            />
        ),
    ].filter((notice): notice is ReactElement => notice !== null);

    return (
        <Page space="md" testID="kitchen-product-editor-screen">
            {/*
             * The opening: the title with its status and handle beside it, the actions at the
             * inline end, the banners under it and one rule closing it. No trail here —
             * `KitchenOpsShell` draws it, and this screen names its last crumb instead. Embedded, the
             * host page has the title, so the row is this listing's status and its own actions.
             */}
            <Stack space="sm">
                {embedded ? (
                    <Inline space="sm" align="center" wrap justify="between">
                        <Inline
                            space="xs"
                            align="center"
                            wrap
                            testID="kitchen-product-editor-screen-meta"
                        >
                            {statusBadge}
                            {dirtyBadge}
                        </Inline>
                        {actions}
                    </Inline>
                ) : (
                    <CataloguePageHeader
                        testID="kitchen-product-editor-screen-header"
                        titleTestID="kitchen-product-editor-screen-title"
                        title={title}
                        titleAside={
                            <Inline
                                space="xs"
                                align="center"
                                wrap
                                testID="kitchen-product-editor-screen-meta"
                            >
                                {statusBadge}
                                {/*
                                 * Nothing issues a resale reference — `ReferenceSeries` has no
                                 * `RSL-` — so a new record has none to preview, and only a saved one
                                 * that the import numbered carries a handle to show.
                                 */}
                                {data?.reference == null ? null : (
                                    <Text
                                        testID="kitchen-product-editor-screen-reference"
                                        variant="mono"
                                        tone="secondary"
                                    >
                                        {data.reference}
                                    </Text>
                                )}
                                {dirtyBadge}
                            </Inline>
                        }
                        primaryAction={actions}
                    />
                )}

                {/* One strip above the other, each the full width — never squeezed side by side. */}
                {dangerItems.length === 0 && warningItems.length === 0 ? null : (
                    <Stack space="xs" testID="kitchen-product-issues">
                        {dangerItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-product-issues-errors"
                                tone="danger"
                                summary={t(
                                    server.items.length === 0 &&
                                        shownBlockers.every((entry) => entry.required)
                                        ? 'kitchen:forms.requiredCount'
                                        : 'kitchen:forms.toFixCount',
                                    { count: dangerItems.length },
                                )}
                                items={dangerItems}
                            />
                        )}
                        {warningItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-product-issues-warnings"
                                tone="warning"
                                summary={t('kitchen:forms.warningCount', {
                                    count: warningItems.length,
                                })}
                                items={warningItems}
                            />
                        )}
                    </Stack>
                )}

                {embedded ? null : <View className="border-b border-stroke" />}
            </Stack>

            {notices.length === 0 ? null : (
                <Stack space="xs" testID="kitchen-product-notices">
                    {notices}
                </Stack>
            )}

            {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
            <View className="z-auto flex-col gap-loose">
                {/* ── description ──────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-product-details"
                    // On a recipe's Selling tab this is the customer-facing listing, not a second
                    // copy of the recipe's own Description tab — so it says so.
                    title={t(embedded ? 'kitchen:forms.menuListing' : 'kitchen:forms.description')}
                >
                    {embedded ? (
                        identityFields
                    ) : (
                        <View className="z-auto flex-row flex-wrap items-start gap-base">
                            {/* Written after the record: see the module note. */}
                            <ImageSlot
                                testID="kitchen-product-image"
                                uri={photo}
                                disabled={!canManage}
                                onChange={(next) => {
                                    setPhoto(next);
                                    const changed = next !== (photoKey ?? null);
                                    setPhotoDirty(changed);
                                    if (changed) guard.markDirty();
                                }}
                            />
                            {identityFields}
                        </View>
                    )}
                </FormSection>

                {/* ── packs ────────────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-product-packs"
                    title={t('kitchen:products.sectionPacks')}
                    description={t('kitchen:products.packsCaption')}
                    actions={
                        canManage ? (
                            <Button
                                testID="kitchen-product-packs-add"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:products.addPack')}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={() => {
                                    edit({ packs: [...details.packs, emptyPack(takePackKey())] });
                                }}
                            />
                        ) : undefined
                    }
                >
                    {/*
                     * The anchor the banner's `Packs` chip scrolls to while there is no row to
                     * focus. A product with no pack is a record no price list can point at and no
                     * order line can measure, so the save refuses it.
                     */}
                    <View nativeID={PACKS_ANCHOR} className="z-auto gap-tight">
                        <PackVariantEditor
                            testID={PACK_EDITOR_TEST_ID}
                            rows={details.packs}
                            errors={shownPackErrors}
                            fieldError={packFieldError}
                            canManage={canManage}
                            onChange={(next) => {
                                edit({ packs: next });
                            }}
                        />
                        {shows('packs') && packsMissing ? (
                            <Text
                                testID="kitchen-product-packs-required"
                                variant="caption"
                                tone="danger"
                            >
                                {t('kitchen:forms.required')}
                            </Text>
                        ) : null}
                    </View>
                </FormSection>

                {/* ── B2B / B2C weight and price ──────────────────────────────────────────── */}
                {isCreating ? (
                    <ChannelPricesSection
                        itemId={null}
                        draft={{
                            value: channelPriceDraft,
                            onChange: (next) => {
                                setChannelPriceDraft(next);
                                guard.markDirty();
                            },
                            attempted,
                            ...(isCurrencyCode(reference.data?.defaultCurrencyCode)
                                ? { currency: reference.data.defaultCurrencyCode }
                                : {}),
                        }}
                    />
                ) : data === undefined ? null : (
                    <ChannelPricesSection itemId={data.id} />
                )}

                {/* ── sale ─────────────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-product-sale"
                    title={t('kitchen:sale.title')}
                >
                    <Stack space="sm">
                        {/*
                         * Read-only: what the kitchen last paid, per the unit it was bought in, and
                         * from whom (the hint). Not on a new item, and not for a member who may not
                         * see costs.
                         */}
                        {isCreating || !canViewCosts ? null : (
                            <FormGrid track="half" testID="kitchen-product-last-price-grid">
                                <QuantityInput
                                    testID="kitchen-product-unit-price"
                                    id="kitchen-product-unit-price"
                                    size="sm"
                                    readOnly
                                    label={t('kitchen:fields.unitPrice')}
                                    placeholder={lastPricePlaceholder}
                                    value={lastPriceValue}
                                    {...(latestPurchase === null ||
                                    latestPurchase.unitPriceAmount === null
                                        ? {}
                                        : {
                                              unit: t('kitchen:fields.unitPricePer', {
                                                  currency: latestPurchase.costCurrencyCode ?? '',
                                                  unit: latestPurchase.unitCode ?? '',
                                              }),
                                              hint: lastPriceSource,
                                          })}
                                    onChangeText={() => {}}
                                />
                            </FormGrid>
                        )}

                        {/*
                         * What one sold unit takes off the shelf (PROD1), on the half track — a
                         * figure and its unit, each one cell.
                         *
                         * Every family on this screen sells from **finished stock**. Where that
                         * shelf is counted in kilograms or litres, a sold unit has to say how much
                         * of it it is, or the sale is refused rather than guessed at. A shelf
                         * counted in pieces needs none, which is why this is offered rather than
                         * demanded: this screen holds no ingredient link and so cannot tell which
                         * kind of shelf it is. The server can, and its refusal names this field.
                         */}
                        {canReadUnits ? (
                            <Stack space="xs">
                                <FormGrid track="half" testID="kitchen-product-sale-grid">
                                    <QuantityInput
                                        testID="kitchen-product-net-content"
                                        id="kitchen-product-net-content"
                                        size="sm"
                                        label={t('kitchen:products.netContentLabel')}
                                        hint={t('kitchen:products.netContentHint')}
                                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                                        value={details.netContentQuantity}
                                        disabled={!canManage}
                                        {...(shows('net-content')
                                            ? { error: t('kitchen:products.netContentInvalid') }
                                            : {})}
                                        {...server.flag('net_content_quantity')}
                                        onChangeText={(next) => {
                                            edit({ netContentQuantity: next });
                                        }}
                                    />
                                    <Select
                                        testID="kitchen-product-net-content-unit"
                                        id="kitchen-product-net-content-unit"
                                        label={t('kitchen:products.netContentUnitLabel')}
                                        placeholder={t('kitchen:fields.unitPlaceholder')}
                                        searchable
                                        disabled={!canManage}
                                        options={unitOptions}
                                        value={details.netContentUnitId ?? ''}
                                        {...(shows('net-content-unit')
                                            ? { error: t('kitchen:forms.required') }
                                            : {})}
                                        {...server.flag('net_content_unit_id')}
                                        onChange={(next) => {
                                            edit({ netContentUnitId: next });
                                        }}
                                    />
                                </FormGrid>
                            </Stack>
                        ) : details.netContentQuantity === '' ? null : (
                            <Callout
                                testID="kitchen-product-net-content-unavailable"
                                tone="info"
                                title={t('kitchen:products.netContentLabel')}
                                body={t('kitchen:products.netContentUnitsForbidden')}
                            />
                        )}

                        {/*
                         * Two flags, two words each. `isMarketPriced` is not decoration: a product
                         * priced at the day's rate carries no confirmed price, and the price list
                         * records that absence as `market_priced` with a NULL amount rather than a
                         * number nobody agreed. `isAssorted` says the row stands for a mixed
                         * selection, which is how the source material's "assorted" lines survive
                         * without being invented into articles that do not exist.
                         */}
                        <Inline space="md" wrap>
                            <Checkbox
                                testID="kitchen-product-market-priced"
                                id="kitchen-product-market-priced"
                                label={t('kitchen:products.marketPricedShort')}
                                checked={details.isMarketPriced}
                                disabled={!canManage}
                                {...server.flag('is_market_priced')}
                                onChange={(checked) => {
                                    edit({ isMarketPriced: checked });
                                }}
                            />
                            <Checkbox
                                testID="kitchen-product-assorted"
                                id="kitchen-product-assorted"
                                label={t('kitchen:products.assortedShort')}
                                checked={details.isAssorted}
                                disabled={!canManage}
                                {...server.flag('is_assorted')}
                                onChange={(checked) => {
                                    edit({ isAssorted: checked });
                                }}
                            />
                        </Inline>
                    </Stack>
                </FormSection>

                {/* ── sales channels ───────────────────────────────────────────────────────── */}
                {/*
                 * Ticked before the record exists, not after it. The rows are held in local state
                 * and written by the create the moment the product has an id — see `save`.
                 */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-product-channels"
                    title={t('kitchen:channels.sectionTitle')}
                >
                    <ChannelAvailabilityEditor
                        testID="kitchen-product-channel-editor"
                        rows={channels}
                        offered={sellableChannels.data}
                        canManage={canManage}
                        onChange={(next) => {
                            setChannelRows(next);
                            markChannelsDirty();
                        }}
                    />
                </FormSection>

                {/* ── diet classifications, read-only ──────────────────────────────────────── */}
                <FormSection
                    first
                    variant="card"
                    testID="kitchen-product-diets"
                    title={t('kitchen:products.dietsLabel')}
                    aside={
                        <Badge
                            variant="label"
                            testID="kitchen-product-diets-source"
                            tone="info"
                            label={t('kitchen:products.dietsFromRecipe')}
                        />
                    }
                    actions={
                        embedded || details.recipeId === null ? undefined : (
                            <Button
                                testID="kitchen-product-recipe-open"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:products.openRecipe')}
                                onPress={openRecipe}
                            />
                        )
                    }
                >
                    {details.recipeId === null ? (
                        <Text
                            testID="kitchen-product-diets-none"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:products.dietsRailEmpty')}
                        </Text>
                    ) : data === undefined || data.dietClassifications.length === 0 ? (
                        // An em dash, not a sentence: "none derived" and "suits no diet" are
                        // different claims, and this section can state neither.
                        <Text testID="kitchen-product-diets-empty" variant="mono" tone="secondary">
                            {t('kitchen:list.noValue')}
                        </Text>
                    ) : (
                        <Inline space="xs" wrap>
                            {data.dietClassifications.map((diet) => (
                                <Tag
                                    key={diet}
                                    testID={`kitchen-product-diet-${diet}`}
                                    tone="neutral"
                                    label={t(dietClassificationKey(diet))}
                                />
                            ))}
                        </Inline>
                    )}
                </FormSection>

                {/* ── source transcription, read-only ──────────────────────────────────────── */}
                {data === undefined ||
                (data.composition === null && data.kitchenCategory === null) ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-product-composition"
                        title={t('kitchen:fields.composition')}
                    >
                        <Stack space="xs">
                            {data.kitchenCategory === null ? null : (
                                <Text
                                    testID="kitchen-product-composition-category"
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {data.kitchenSubcategory === null
                                        ? data.kitchenCategory
                                        : `${data.kitchenCategory} / ${data.kitchenSubcategory}`}
                                </Text>
                            )}
                            {data.composition === null ? null : (
                                <Text testID="kitchen-product-composition-text">
                                    {data.composition}
                                </Text>
                            )}
                        </Stack>
                    </FormSection>
                )}
            </View>

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-product-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:products.publishTitle')}
                description={t('kitchen:products.publishBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-product-publish-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-product-publish-confirm"
                            label={t('kitchen:publish.action')}
                            loading={publish.isPending}
                            // The same guard the button carries. A dialog left open across a save
                            // that dirtied the form would otherwise publish what is on the server
                            // rather than what the person is looking at.
                            disabled={publishBlocked}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        productId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowPublish(false);
                                            toast.show({
                                                testID: 'kitchen-product-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:products.publishedToast', {
                                                    name: displayName(details.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            setShowPublish(false);
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />

            {/* ── archive ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-product-archive-dialog"
                open={showArchive}
                onClose={() => {
                    setShowArchive(false);
                }}
                title={t('kitchen:products.archiveTitle')}
                description={t('kitchen:products.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-product-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowArchive(false);
                            }}
                        />
                        <Button
                            testID="kitchen-product-archive-confirm"
                            variant="danger"
                            label={t('kitchen:products.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                archive.mutate(
                                    {
                                        productId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowArchive(false);
                                            toast.show({
                                                testID: 'kitchen-product-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:products.archivedToast', {
                                                    name: displayName(details.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            setShowArchive(false);
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Text testID="kitchen-product-archive-consequence">
                    {t('kitchen:products.archiveConsequence')}
                </Text>
            </Dialog>

            {/* ── the two guards ───────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-product-editor-screen-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-product-editor-screen-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-product-editor-screen-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />

            <Dialog
                testID="kitchen-product-editor-screen-conflict-dialog"
                open={concurrency.conflict !== null}
                onClose={concurrency.keepEditing}
                dismissOnBackdrop={false}
                title={t('kitchen:conflict.title')}
                description={t('kitchen:conflict.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-product-editor-screen-conflict-keep"
                            variant="quiet"
                            label={t('kitchen:conflict.keepEditing')}
                            onPress={concurrency.keepEditing}
                        />
                        <Button
                            testID="kitchen-product-editor-screen-conflict-reload"
                            variant="danger"
                            label={t('kitchen:conflict.reload')}
                            onPress={concurrency.reload}
                        />
                    </>
                }
            >
                {concurrency.conflict === null ? null : (
                    <Text
                        testID="kitchen-product-editor-screen-conflict-detail"
                        tone="secondary"
                        variant="caption"
                    >
                        {concurrency.conflict.failure.message}
                    </Text>
                )}
            </Dialog>
        </Page>
    );
}
