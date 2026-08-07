import type {
    LocalisedText,
    ProductAdmin,
    ProductPackVariant,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { ProductId } from '@healthy360/domain-types';
import type { RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useArchiveProductMutation,
    useCreateProductMutation,
    useProductCategoriesQuery,
    useProductQuery,
    useRecipesQuery,
    useSetProductChannelAvailabilityMutation,
    useUpdateProductMutation,
} from '../../../data/kitchen-admin-hooks.ts';
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
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
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
 * - **Publication.** `KitchenAdminRepository` has `archiveProduct` and no `publishProduct`. The
 *   status is shown, archive is offered, and no control implies a transition with no endpoint behind
 *   it. A quarantined product renders its quarantine, because that state is real and is what a
 *   person has to go and resolve, but nothing here claims to be able to clear it.
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

/** The "bought in rather than cooked" answer of the recipe picker. Never a real identifier. */
const NO_RECIPE = '__none__';

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly categoryCode: string;
    readonly recipeId: RecipeId | null;
    readonly isMarketPriced: boolean;
    readonly isAssorted: boolean;
    readonly packs: readonly PackDraft[];
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    categoryCode: '',
    recipeId: null,
    isMarketPriced: false,
    isAssorted: false,
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

/** The editor's packs as the contract's payload. Called only once the row errors are empty. */
function packRequest(rows: readonly PackDraft[]): readonly ProductPackVariant[] {
    return rows.map((row) => ({
        code: row.code.trim().toUpperCase(),
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
}

export function ProductEditScreen({ product }: ProductEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-product-editor"
        >
            <ProductEditor product={product} />
        </Gate>
    );
}

function ProductEditor({ product }: ProductEditScreenProps) {
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
    const archive = useArchiveProductMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [channels, setChannelRows] = useState<readonly ChannelDraft[]>([]);
    const [channelsKey, setChannelsKey] = useState<string | null>(null);
    const [channelsDirty, setChannelsDirty] = useState(false);

    const [nextPackOrdinal, setNextPackOrdinal] = useState(1);
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
    const detailsBlocked = nameMissing || categoryMissing || packRowErrors.size > 0;

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveDetails = () => {
        if (detailsBlocked) return;

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    description: details.description,
                    categoryCode: details.categoryCode,
                    isMarketPriced: details.isMarketPriced,
                    isAssorted: details.isAssorted,
                    packVariants: packRequest(details.packs),
                    ...(details.recipeId === null ? {} : { recipeId: details.recipeId }),
                },
                {
                    onSuccess: (created) => {
                        settle(false, false);
                        toast.show({
                            testID: 'kitchen-product-created-toast',
                            tone: 'success',
                            message: t('kitchen:products.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`/kitchen/products/${String(created.id)}` as never);
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
                                router.push('/kitchen/products' as never);
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
            backLabel={t('kitchen:products.backToList')}
            onBack={() => {
                router.push('/kitchen/products' as never);
            }}
            primaryAction={
                isCreating || !canManage || data?.meta.status === 'retired' ? null : (
                    <Button
                        testID="kitchen-product-archive"
                        variant="secondary"
                        label={t('kitchen:list.archive')}
                        onPress={() => {
                            setShowArchive(true);
                        }}
                    />
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
            {/* ── the record ───────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-product-details" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:products.sectionDetails')}</Heading>

                    <BilingualField
                        testID="kitchen-product-name"
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
                        fieldLabel={t('kitchen:products.descriptionLabel')}
                        multiline
                        value={details.description}
                        onChange={(next) => {
                            setDetails({ ...details, description: next });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-product-category"
                        id="kitchen-product-category"
                        label={t('kitchen:fields.category')}
                        hint={t('kitchen:products.categoryHint')}
                        placeholder={t('kitchen:fields.categoryPlaceholder')}
                        searchable
                        required
                        disabled={!canManage}
                        options={categoryOptions}
                        value={details.categoryCode === '' ? null : details.categoryCode}
                        {...(categoryMissing
                            ? { error: t('kitchen:editor.categoryRequired') }
                            : {})}
                        onChange={(next) => {
                            setDetails({ ...details, categoryCode: next });
                            markDetailsDirty();
                        }}
                    />

                    {/*
                     * Two flags, two sentences. `isMarketPriced` is not decoration: a product priced
                     * at the day's rate carries no confirmed price, and the price list records that
                     * absence as `market_priced` with a NULL amount rather than a number nobody
                     * agreed. `isAssorted` says the row stands for a mixed selection, which is how
                     * the source material's "assorted" lines survive without being invented into
                     * articles that do not exist.
                     */}
                    <Checkbox
                        testID="kitchen-product-market-priced"
                        id="kitchen-product-market-priced"
                        label={t('kitchen:products.marketPricedLabel')}
                        description={t('kitchen:products.marketPricedHint')}
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
                        label={t('kitchen:products.assortedLabel')}
                        description={t('kitchen:products.assortedHint')}
                        checked={details.isAssorted}
                        disabled={!canManage}
                        onChange={(checked) => {
                            setDetails({ ...details, isAssorted: checked });
                            markDetailsDirty();
                        }}
                    />
                </Stack>
            </Card>

            {/* ── packs ────────────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-product-packs" padding="md">
                <Stack space="md">
                    <Inline space="sm" align="center" justify="between" wrap>
                        <Heading level={2}>{t('kitchen:products.sectionPacks')}</Heading>
                        {canManage ? (
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
                        ) : null}
                    </Inline>

                    <Text tone="secondary" variant="caption">
                        {t('kitchen:products.packsHint')}
                    </Text>

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
            </Card>

            {/* ── recipe linkage ───────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-product-recipe" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:products.sectionRecipe')}</Heading>

                    <Text tone="secondary" variant="caption">
                        {t('kitchen:products.recipeHint')}
                    </Text>

                    <Select
                        testID="kitchen-product-recipe-select"
                        id="kitchen-product-recipe-select"
                        label={t('kitchen:products.recipeLabel')}
                        searchable
                        disabled={!canManage}
                        options={recipeOptions}
                        value={details.recipeId === null ? NO_RECIPE : String(details.recipeId)}
                        onChange={(next) => {
                            setDetails({
                                ...details,
                                recipeId: next === NO_RECIPE ? null : (next as RecipeId),
                            });
                            markDetailsDirty();
                        }}
                    />

                    {details.recipeId === null ? (
                        <Text testID="kitchen-product-recipe-none" tone="secondary">
                            {t('kitchen:products.recipeNoneHint')}
                        </Text>
                    ) : (
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
                                        router.push(`/kitchen/recipes/${String(target)}` as never);
                                    });
                                }}
                            />
                        </Inline>
                    )}

                    {/*
                     * Derived, and labelled as derived. `ProductAdmin.dietClassifications` is
                     * answered from the linked recipe's published version — see the module note —
                     * so this is a fact about the recipe rendered where a person looking at the
                     * product needs it, not a field they can disagree with here.
                     */}
                    <Stack space="xs" testID="kitchen-product-diets">
                        <Text variant="label">{t('kitchen:products.dietsLabel')}</Text>
                        {data === undefined || data.dietClassifications.length === 0 ? (
                            <Text
                                testID="kitchen-product-diets-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:products.dietsNone')}
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
                    </Stack>

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
                </Stack>
            </Card>

            {/* ── channels ─────────────────────────────────────────────────────────────────── */}
            {isCreating ? (
                <Card testID="kitchen-product-channels-unavailable" padding="md">
                    <Stack space="sm">
                        <Heading level={2}>{t('kitchen:channels.sectionTitle')}</Heading>
                        <Text tone="secondary">{t('kitchen:channels.createFirst')}</Text>
                    </Stack>
                </Card>
            ) : (
                <Card testID="kitchen-product-channels" padding="md">
                    <Stack space="md">
                        <Heading level={2}>{t('kitchen:channels.sectionTitle')}</Heading>

                        <Text tone="secondary" variant="caption">
                            {t('kitchen:channels.sectionHint')}
                        </Text>

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

                        {canManage ? (
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
                        ) : null}
                    </Stack>
                </Card>
            )}

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
