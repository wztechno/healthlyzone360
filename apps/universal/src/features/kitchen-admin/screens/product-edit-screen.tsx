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
    Checkbox,
    Dialog,
    ErrorState,
    FormSection,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { ProductId } from '@healthy360/domain-types';
import type { RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useArchiveProductMutation,
    useCreateProductMutation,
    useProductCategoriesQuery,
    useProductQuery,
    usePublishProductMutation,
    useRecipesQuery,
    useSetProductChannelAvailabilityMutation,
    useUpdateProductMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { useProcurementReferenceQuery } from '../../../data/kitchen-ops-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import {
    ChannelAvailabilityEditor,
    PackVariantEditor,
    channelRequest,
    emptyPack,
    packErrors,
} from '../catalogue-row-editors.tsx';
import type { ChannelDraft, PackDraft } from '../catalogue-row-editors.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { GateRailCard } from '../gate-rail-card.tsx';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import {
    dietClassificationKey,
    displayName,
    humaniseCode,
    parseQuantity,
    parseWholeNumber,
} from '../format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/products/{product}` — the product record, its packs and its routes to market.
 *
 * ## Two sections, two writes, one lock version
 *
 * `updateProduct` carries the record's fields *and* the whole pack list; `setProductChannelAvailability`
 * carries the channels. That split is the contract's, and it is the right one: which routes to market
 * a product is sold through is a commercial act with its own permission and its own audit entry
 * server-side, and folding it into a rename would make that impossible to enforce. Each section has
 * its own save, both carry the same `lockVersion` read from the cache at the moment of saving, and
 * each rehydrates from the server's answer while skipping rehydration whenever *it* holds unsaved
 * edits — so saving the channels never discards a half-typed pack label.
 *
 * ## What this screen deliberately does not offer
 *
 * - **An ingredient list.** The schema has `catalogue_item_ingredients`; the contract publishes no
 *   reader and no writer for it. The linkage this screen *can* show honestly is the recipe the
 *   product is produced from, which `UpdateProductRequest.recipeId` really does set.
 * - **Diet classifications as an editable field.** `ProductAdmin.dietClassifications` is answered
 *   from the linked recipe's published version, so the section renders them with that provenance
 *   rather than as a form. `UpdateProductRequest` nominally accepts them, but nothing behind this
 *   contract stores a product-level override, and a control whose value silently vanished on reload
 *   would be worse than an honest read-only panel.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

/**
 * The "bought in rather than cooked" answer of the recipe picker. Never a real identifier.
 *
 * ## Why this picker survives a cleanup that set out to delete it
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
 * panel two sections down.
 *
 * The cooked kinds are a different question and have a different screen: a sauce or a dressing owns
 * its recipe outright and is edited through `CookedItemEditScreen`, never here.
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

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface ProductEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly product: string | undefined;
    /**
     * Which packaged kind a create makes and which list the screen returns to.
     * The sauces and dressings routes pass theirs; the default is products.
     */
    readonly itemType?: 'product' | 'sauce' | 'dressing' | 'frozen_meal';
    readonly routeBase?:
        '/kitchen/products' | '/kitchen/sauces' | '/kitchen/dressings' | '/kitchen/frozen-meals';
    /**
     * Drawn as a cooked item's Selling tab rather than as a page — a sauce's or a dressing's listing,
     * on the page its recipe is.
     *
     * The recipe is the page the tab sits on, so the recipe picker is not drawn: which formulation a
     * sauce is made from is not a question its listing answers. Nor is the category, which the route
     * has already decided. Both keep their stored values through a save. There is no Back, because
     * the page has its own; and no create, because a cooked item's listing is written by the recipe's
     * first save.
     */
    readonly embedded?: boolean | undefined;
    /** Told when this listing's unsaved state changes, so a host page can guard its own exits. */
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export function ProductEditScreen({
    product,
    itemType = 'product',
    routeBase = '/kitchen/products',
    embedded = false,
    onDirtyChange,
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
    const recipes = useRecipesQuery({ limit: 100 });

    const create = useCreateProductMutation();
    const update = useUpdateProductMutation();
    const setChannels = useSetProductChannelAvailabilityMutation();
    const publish = usePublishProductMutation();
    const archive = useArchiveProductMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    useEffect(() => {
        onDirtyChange?.(guard.isDirty);
    }, [guard.isDirty, onDirtyChange]);

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [channels, setChannelRows] = useState<readonly ChannelDraft[]>([]);
    const [channelsKey, setChannelsKey] = useState<string | null>(null);
    const [channelsDirty, setChannelsDirty] = useState(false);

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
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const takePackKey = (): string => {
        const key = `pack-${String(nextPackOrdinal)}`;
        setNextPackOrdinal(nextPackOrdinal + 1);
        return key;
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

    /** `NO_RECIPE` is the "bought in rather than cooked" answer, and never a real identifier. */
    const recipeRows = recipesFromPages(recipes.data?.pages);
    const recipeOptions: readonly SelectOption[] = useMemo(
        () => [
            { value: NO_RECIPE, label: t('kitchen:products.recipeNone') },
            ...recipeRows.map((row) => ({
                value: String(row.id),
                label: displayName(row.name, locale).value,
                description: row.slug,
            })),
        ],
        [recipeRows, locale, t],
    );

    const linkedRecipe = recipeRows.find((row) => row.id === details.recipeId) ?? null;

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
            (referenceUnits ?? []).map((unit) => ({
                value: unit.id,
                label: unit.code,
                description: unit.nameEn,
            })),
        [referenceUnits],
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
    const categoryMissing = details.categoryCode.trim() === '';
    const packsBlocked = details.packs.length === 0 || packRowErrors.size > 0;

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

    const detailsBlocked =
        nameMissing ||
        categoryMissing ||
        packsBlocked ||
        netContentInvalid ||
        netContentUnitMissing;

    /**
     * The rail's rows, the save button's `disabled`, and the publish gate, from one set of
     * predicates.
     *
     * The rail used to say "before you can save" because this family had no publish action. It has
     * one now — `POST /catalogue/items/{item}/publish` was always generic over `item_type` and only
     * the client method was missing — so the same four checks serve both acts, and `publishBlockers`
     * below reads them rather than restating them.
     *
     * Channels are on the list and are the one row the save does not block on. The channels write
     * is a separate call against a separate lock, so refusing to save the record because a route is
     * unticked would trap a valid record behind a second endpoint. Publication *does* wait for it:
     * an item routed to no channel is published where nobody can see it.
     */
    const gateChecks = [
        {
            key: 'name',
            label: t('kitchen:products.gateCheckName'),
            passed: !nameMissing,
            note: t('kitchen:products.blockName'),
        },
        {
            key: 'category',
            label: t('kitchen:products.gateCheckCategory'),
            passed: !categoryMissing,
            note: t('kitchen:products.blockCategory'),
        },
        {
            key: 'packs',
            label: t('kitchen:products.gateCheckPacks'),
            passed: !packsBlocked,
            note: t('kitchen:products.blockPacks'),
        },
        {
            key: 'channels',
            label: t('kitchen:products.gateCheckChannels', {
                count: channels.filter((row) => row.isAvailable).length,
            }),
            passed: channels.some((row) => row.isAvailable),
            note: t('kitchen:products.blockChannels'),
        },
    ];

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

    const saveDetails = () => {
        if (detailsBlocked) return;

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    description: details.description,
                    categoryCode: details.categoryCode,
                    itemType,
                    isMarketPriced: details.isMarketPriced,
                    isAssorted: details.isAssorted,
                    packVariants: packRequest(details.packs),
                    ...(details.recipeId === null ? {} : { recipeId: details.recipeId }),
                    ...netContentRequest,
                },
                {
                    onSuccess: (created) => {
                        toast.show({
                            testID: 'kitchen-product-created-toast',
                            tone: 'success',
                            message: t('kitchen:products.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });

                        const open = () => {
                            settle(false, false);
                            router.replace(`${routeBase}/${String(created.id)}` as never);
                        };

                        /*
                         * Routes to market can be ticked before the product exists, so they arrive
                         * here with nowhere to have been written yet - the channels endpoint takes
                         * a product id. This is the first moment there is one.
                         *
                         * `onSettled`, not `onSuccess`: the record itself is saved either way, and
                         * stranding somebody on a create form for a record that already exists is
                         * worse than landing them on it with the gate saying the routes are unset.
                         */
                        if (!channels.some((row) => row.isAvailable)) {
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
                },
            );
            return;
        }

        if (data === undefined) return;
        update.mutate(
            {
                productId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    description: details.description,
                    categoryCode: details.categoryCode,
                    recipeId: details.recipeId,
                    isMarketPriced: details.isMarketPriced,
                    isAssorted: details.isAssorted,
                    packVariants: packRequest(details.packs),
                    ...netContentRequest,
                },
            },
            {
                onSuccess: () => {
                    settle(false, channelsDirty);
                    toast.show({
                        testID: 'kitchen-product-saved-toast',
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

    const saveChannels = () => {
        if (data === undefined) return;
        setChannels.mutate(
            {
                productId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    availability: channelRequest(channels),
                },
            },
            {
                onSuccess: () => {
                    settle(detailsDirty, false);
                    toast.show({
                        testID: 'kitchen-product-channels-saved-toast',
                        tone: 'success',
                        message: t('kitchen:channels.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-product-editor-screen">
                <Callout
                    testID="kitchen-product-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:products.notFoundTitle')}
                    body={t('kitchen:products.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-product-not-found-back"
                            variant="quiet"
                            label={t('kitchen:products.backToList')}
                            onPress={() => {
                                router.push(routeBase as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-product-editor-loading">
                <Skeleton testID="kitchen-product-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-product-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-product-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-product-editor-screen">
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
    const channelFailure = toFailure(setChannels.error);
    const quarantined = data?.meta.status === 'review_required';
    const isPublished = data?.meta.status === 'published';

    /*
     * The client-side half of the publish gate, read off the rail that is already on screen.
     *
     * Deliberately not a second list of predicates: the rail above already states the four things
     * this record needs and already has translated copy for each, and two lists would drift the
     * first time somebody added a fifth. What publication adds to saving is one further condition —
     * an unsaved edit — because publish sends a lock version and publishes what the *server* holds,
     * not what is on screen.
     *
     * `CatalogueItemReadiness` on the server is still the authority and refuses more than this: an
     * item that cannot say what is in it, or whose linked recipe carries a quarantined version.
     * These are only the ones a person can see and fix from this form.
     */
    const publishBlockers: readonly string[] = [
        ...gateChecks.filter((check) => !check.passed).map((check) => check.note),
        ...(detailsDirty || channelsDirty ? [t('kitchen:products.blockUnsaved')] : []),
    ];

    return (
        <EditorFrame
            testID="kitchen-product-editor-screen"
            title={isCreating ? t('kitchen:products.createTitle') : t('kitchen:products.editTitle')}
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={create.isPending || update.isPending}
            saveDisabled={!canManage || detailsBlocked}
            backLabel={t('kitchen:common.cancel')}
            onBack={() => {
                router.push(routeBase as never);
            }}
            actionsPlacement="header"
            headerVariant="plain"
            embedded={embedded}
            rail={
                <Stack space="md">
                    <GateRailCard
                        testID="kitchen-product-gate"
                        title={t('kitchen:products.gateTitle')}
                        checks={gateChecks}
                    />

                    {/*
                     * Derived, and labelled as derived. `ProductAdmin.dietClassifications` is
                     * answered from the linked recipe published version - see the module note - so
                     * this is a fact about the recipe shown where somebody looking at the product
                     * needs it, not a field they can disagree with here.
                     */}
                    <View
                        testID="kitchen-product-diets"
                        className="gap-2 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                    >
                        <Inline space="xs" align="center" wrap>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:products.dietsRailTitle')}
                            </Text>
                            <Badge
                                testID="kitchen-product-diets-source"
                                tone="neutral"
                                label={t('kitchen:products.dietsFromRecipe')}
                            />
                        </Inline>

                        {data === undefined || data.dietClassifications.length === 0 ? (
                            <Text
                                testID="kitchen-product-diets-none"
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:products.dietsRailEmpty')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {data.dietClassifications.map((diet) => (
                                    <Badge
                                        key={diet}
                                        testID={`kitchen-product-diet-${diet}`}
                                        tone="neutral"
                                        label={t(dietClassificationKey(diet))}
                                    />
                                ))}
                            </Inline>
                        )}

                        <Text variant="caption" tone="secondary">
                            {t('kitchen:products.dietsProvenance')}
                        </Text>
                    </View>
                </Stack>
            }
            primaryAction={
                isCreating || !canManage || data?.meta.status === 'retired' ? null : (
                    <Inline space="sm" align="center">
                        <Button
                            testID="kitchen-product-archive"
                            variant="secondary"
                            label={t('kitchen:list.archive')}
                            onPress={() => {
                                setShowArchive(true);
                            }}
                        />
                        {isPublished ? null : (
                            <Button
                                testID="kitchen-product-publish"
                                label={t('kitchen:publish.action')}
                                // Visibly disabled while anything this screen can check fails, and
                                // while the row is quarantined — the dialog's confirm keeps the
                                // same guard, and the server keeps the real one.
                                disabled={publishBlockers.length > 0 || quarantined}
                                onPress={() => {
                                    setShowPublish(true);
                                }}
                            />
                        )}
                    </Inline>
                )
            }
            banner={
                <Stack space="sm">
                    {/*
                     * A quarantine is rendered, never resolved from here: `review_required` blocks
                     * publication structurally (plan §4.7) and is cleared by fixing the allergen
                     * determination it came from, on the ingredient. This product family has no
                     * publish action at all, so the notice explains rather than offering a way out.
                     */}
                    {data === undefined || data.dataQualityFlags.length === 0 ? null : (
                        <Callout
                            testID="kitchen-product-data-quality"
                            role="note"
                            tone="warning"
                            title={t('kitchen:products.dataQualityTitle')}
                            body={t('kitchen:products.dataQualityBody')}
                        >
                            <Inline space="xs" wrap>
                                {data.dataQualityFlags.map((flag) => (
                                    <Badge
                                        key={flag}
                                        testID={`kitchen-product-flag-${flag}`}
                                        tone="warning"
                                        label={humaniseCode(flag)}
                                    />
                                ))}
                            </Inline>
                        </Callout>
                    )}

                    {quarantined ? (
                        <Callout
                            testID="kitchen-product-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:products.quarantineTitle')}
                            body={t('kitchen:products.quarantineBody')}
                        />
                    ) : null}
                    {data?.meta.status === 'retired' ? (
                        <Callout
                            testID="kitchen-product-archived"
                            role="note"
                            tone="info"
                            title={t('kitchen:products.archivedTitle')}
                            body={t('kitchen:products.archivedBody')}
                        />
                    ) : null}
                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-product-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/*
             * 12px between sections, not 24. `FormSection` already draws 24px under its own
             * hairline and 12px under its title; a `loose` container gap on top of that spends a
             * third of the panel on separation. This is the space above each rule only.
             */}
            <View className="z-auto flex-col gap-snug">
                {/* ── the record ───────────────────────────────────────────────────────────────── */}
                {/*
                 * `FormSection`, not a `Card` with a `Heading` — the shape every Catalogue editor
                 * takes, and the reason a reader moving between them meets one form rather than
                 * several.
                 *
                 * The field layout is stated row by row rather than left to `FormGrid`; see the
                 * note on the rows themselves for why a bilingual pair cannot be auto-placed.
                 */}
                <FormSection
                    first
                    testID="kitchen-product-details"
                    title={t('kitchen:products.sectionIdentity')}
                >
                    {/*
                     * Explicit two-up rows, not `FormGrid`.
                     *
                     * The grid places fields on 280px tracks in source order and wraps them, which is
                     * right for a form of short independent answers and wrong for this one: a name and
                     * its translation are one answer in two boxes, and auto-placement kept splitting
                     * the pairs across rows and columns - Category ended up beside a description, and
                     * the two halves of a bilingual field landed in different rows. Each row here is a
                     * pair that belongs together, and each half fills its share of the panel.
                     */}
                    <Stack space="md">
                        {/*
                         * Drawn only once the record has one.
                         *
                         * Nothing issues a resale reference - `ReferenceSeries` is `ING-` | `RC-` |
                         * `SAC-` | `DRS-`, with no resale series to count - so while creating this was a
                         * permanently empty, permanently disabled box at the top of the form. A field
                         * that can never hold anything on the screen it is drawn on is furniture; on a
                         * saved record the handle is real and worth reading, so it stays there.
                         */}
                        {data?.reference == null ? null : (
                            <TextInputField
                                testID="kitchen-product-reference"
                                id="kitchen-product-reference"
                                label={t('kitchen:list.columnReference')}
                                size="sm"
                                value={data.reference}
                                disabled
                                onChangeText={() => undefined}
                            />
                        )}

                        <BilingualField
                            testID="kitchen-product-name"
                            layout="fill"
                            fieldLabel={t('kitchen:fields.name')}
                            value={details.name}
                            requiredEnglish
                            {...(nameMissing
                                ? { englishError: t('kitchen:products.nameRequired') }
                                : {})}
                            onChange={(next) => {
                                setDetails({ ...details, name: next });
                                markDetailsDirty();
                            }}
                        />

                        <BilingualField
                            testID="kitchen-product-description"
                            layout="fill"
                            fieldLabel={t('kitchen:products.descriptionLabel')}
                            multiline
                            value={details.description}
                            onChange={(next) => {
                                setDetails({ ...details, description: next });
                                markDetailsDirty();
                            }}
                        />

                        {/*
                         * "What is it filed under" and "where does it come from" are asked of a new
                         * resale item in the same breath, so they share a row. The recipe hint answers
                         * the state the field is in: with no recipe there is nothing to derive.
                         */}
                        {embedded ? null : (
                            <View className="z-auto flex-col gap-base md:flex-row">
                                <View className="z-auto min-w-0 flex-1">
                                    <Select
                                        testID="kitchen-product-category"
                                        id="kitchen-product-category"
                                        label={t('kitchen:fields.category')}
                                        placeholder={t('kitchen:fields.categoryPlaceholder')}
                                        searchable
                                        required
                                        disabled={!canManage}
                                        options={categoryOptions}
                                        value={
                                            details.categoryCode === ''
                                                ? null
                                                : details.categoryCode
                                        }
                                        {...(categoryMissing
                                            ? { error: t('kitchen:editor.categoryRequired') }
                                            : {})}
                                        onChange={(next) => {
                                            setDetails({ ...details, categoryCode: next });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>

                                <View className="z-auto min-w-0 flex-1">
                                    <Select
                                        testID="kitchen-product-recipe-select"
                                        id="kitchen-product-recipe-select"
                                        label={t('kitchen:products.recipeLabel')}
                                        placeholder={t('kitchen:products.recipePlaceholder')}
                                        searchable
                                        disabled={!canManage}
                                        options={recipeOptions}
                                        value={
                                            details.recipeId === null
                                                ? NO_RECIPE
                                                : String(details.recipeId)
                                        }
                                        {...(details.recipeId === null
                                            ? { hint: t('kitchen:products.recipeHintNone') }
                                            : {})}
                                        onChange={(next) => {
                                            setDetails({
                                                ...details,
                                                recipeId:
                                                    next === NO_RECIPE ? null : (next as RecipeId),
                                            });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>
                            </View>
                        )}

                        {/*
                         * Two flags, two words each. `isMarketPriced` is not decoration: a product
                         * priced at the day's rate carries no confirmed price, and the price list
                         * records that absence as `market_priced` with a NULL amount rather than a
                         * number nobody agreed. `isAssorted` says the row stands for a mixed selection,
                         * which is how the source material's "assorted" lines survive without being
                         * invented into articles that do not exist. Both sentences moved to the label's
                         * own hint rather than a paragraph under each box: side by side, two
                         * three-line explanations were taller than the form above them.
                         */}
                        <Inline space="md" wrap>
                            <Checkbox
                                testID="kitchen-product-market-priced"
                                id="kitchen-product-market-priced"
                                label={t('kitchen:products.marketPricedShort')}
                                checked={details.isMarketPriced}
                                disabled={!canManage}
                                onChange={(checked) => {
                                    setDetails({ ...details, isMarketPriced: checked });
                                    markDetailsDirty();
                                }}
                            />

                            <Checkbox
                                testID="kitchen-product-assorted"
                                id="kitchen-product-assorted"
                                label={t('kitchen:products.assortedShort')}
                                checked={details.isAssorted}
                                disabled={!canManage}
                                onChange={(checked) => {
                                    setDetails({ ...details, isAssorted: checked });
                                    markDetailsDirty();
                                }}
                            />
                        </Inline>

                        {/*
                         * What one sold unit takes off the shelf (PROD1).
                         *
                         * Every family on this screen sells from **finished stock** — it was made or
                         * bought earlier and the sale draws the made thing, never its recipe. Where
                         * that shelf is counted in kilograms or litres, a sold unit has to say how
                         * much of it it is, or the sale is refused rather than guessed at. A shelf
                         * counted in pieces needs none, which is why this is offered rather than
                         * demanded: this screen holds no ingredient link and so cannot tell which
                         * kind of shelf it is. The server can, and its refusal names this field.
                         */}
                        {canReadUnits ? (
                            <View className="z-auto flex-col gap-base md:flex-row">
                                <View className="z-auto min-w-0 flex-1">
                                    <TextInputField
                                        testID="kitchen-product-net-content"
                                        id="kitchen-product-net-content"
                                        label={t('kitchen:products.netContentLabel')}
                                        hint={t('kitchen:products.netContentHint')}
                                        value={details.netContentQuantity}
                                        inputMode="decimal"
                                        disabled={!canManage}
                                        {...(netContentInvalid
                                            ? { error: t('kitchen:products.netContentInvalid') }
                                            : {})}
                                        onChangeText={(next) => {
                                            setDetails({ ...details, netContentQuantity: next });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>

                                <View className="z-auto min-w-0 flex-1">
                                    <Select
                                        testID="kitchen-product-net-content-unit"
                                        id="kitchen-product-net-content-unit"
                                        label={t('kitchen:products.netContentUnitLabel')}
                                        searchable
                                        disabled={!canManage}
                                        options={unitOptions}
                                        value={details.netContentUnitId ?? ''}
                                        {...(netContentUnitMissing
                                            ? {
                                                  error: t(
                                                      'kitchen:products.netContentUnitMissing',
                                                  ),
                                              }
                                            : {})}
                                        onChange={(next) => {
                                            setDetails({ ...details, netContentUnitId: next });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>
                            </View>
                        ) : details.netContentQuantity === '' ? null : (
                            <Callout
                                testID="kitchen-product-net-content-unavailable"
                                tone="info"
                                title={t('kitchen:products.netContentLabel')}
                                body={t('kitchen:products.netContentUnitsForbidden')}
                            />
                        )}

                        {embedded || details.recipeId === null ? null : (
                            <Inline space="sm" align="center" wrap>
                                <Text testID="kitchen-product-recipe-linked">
                                    {linkedRecipe === null
                                        ? String(details.recipeId)
                                        : displayName(linkedRecipe.name, locale).value}
                                </Text>
                                <Button
                                    testID="kitchen-product-recipe-open"
                                    size="sm"
                                    variant="ghost"
                                    label={t('kitchen:products.openRecipe')}
                                    onPress={() => {
                                        const target = details.recipeId;
                                        if (target === null) return;
                                        guard.intercept(() => {
                                            router.push(
                                                `/kitchen/recipes/${String(target)}` as never,
                                            );
                                        });
                                    }}
                                />
                            </Inline>
                        )}
                    </Stack>
                </FormSection>

                {/* ── packs ────────────────────────────────────────────────────────────────────── */}
                {/*
                 * `actions` rather than an `Inline … justify="between"` of my own: the section already
                 * owns that row, and hand-rolling it put the Add button on a different baseline from
                 * every other section header in the workspace. `description` likewise replaces the
                 * caption `Text` under the title.
                 */}
                <FormSection
                    testID="kitchen-product-packs"
                    title={t('kitchen:products.sectionPacks')}
                    aside={
                        <Text
                            testID="kitchen-product-packs-count"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:products.packCount', { count: details.packs.length })}
                        </Text>
                    }
                    actions={
                        canManage ? (
                            <Button
                                testID="kitchen-product-packs-add"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:products.addPack')}
                                onPress={() => {
                                    setDetails({
                                        ...details,
                                        packs: [...details.packs, emptyPack(takePackKey())],
                                    });
                                    markDetailsDirty();
                                }}
                            />
                        ) : undefined
                    }
                >
                    <Stack space="md">
                        <PackVariantEditor
                            testID="kitchen-product-pack-editor"
                            rows={details.packs}
                            errors={packRowErrors}
                            canManage={canManage}
                            onChange={(next) => {
                                setDetails({ ...details, packs: next });
                                markDetailsDirty();
                            }}
                        />
                    </Stack>
                </FormSection>

                {/* ── source transcription ─────────────────────────────────────────────────────── */}
                {data?.composition == null && data?.kitchenCategory == null ? null : (
                    <FormSection
                        testID="kitchen-product-composition"
                        title={t('kitchen:fields.composition')}
                    >
                        <Stack space="sm">
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

                {/* ── channels ─────────────────────────────────────────────────────────────────── */}
                {/*
                 * Ticked before the record exists, not after it. The rows are held in local state and
                 * written by the create branch the moment the product has an id - see `saveDetails`.
                 * That is also why the aside says the section saves separately: it is a different
                 * endpoint against a different lock, which is the contract's split, not a UI choice.
                 */}
                <FormSection
                    testID="kitchen-product-channels"
                    title={t('kitchen:channels.sectionTitle')}
                    aside={
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:channels.savedSeparately')}
                        </Text>
                    }
                >
                    <Stack space="md">
                        {channelFailure === null ? null : (
                            <Callout
                                testID="kitchen-product-channels-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:channels.saveError')}
                                body={channelFailure.message}
                            />
                        )}

                        <ChannelAvailabilityEditor
                            testID="kitchen-product-channel-editor"
                            rows={channels}
                            canManage={canManage}
                            onChange={(next) => {
                                setChannelRows(next);
                                markChannelsDirty();
                            }}
                        />

                        {/*
                         * The separate save appears once there is a record to save against, and
                         * only when something has actually changed - on a new product the create
                         * writes these rows itself, so a second button would be a second way to do
                         * the same thing, disabled most of the time.
                         */}
                        {isCreating || !canManage || !channelsDirty ? null : (
                            <Inline space="sm" wrap justify="end">
                                <Button
                                    testID="kitchen-product-channels-save"
                                    variant="secondary"
                                    label={t('kitchen:channels.save')}
                                    loading={setChannels.isPending}
                                    disabled={setChannels.isPending}
                                    onPress={saveChannels}
                                />
                            </Inline>
                        )}
                    </Stack>
                </FormSection>
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
                            disabled={publishBlockers.length > 0 || quarantined}
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
        </EditorFrame>
    );
}
