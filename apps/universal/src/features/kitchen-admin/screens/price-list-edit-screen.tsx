import { isValidationFailure } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { PriceListId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    mealsFromPages,
    plansFromPages,
    productsFromPages,
    useAdminMealsQuery,
    useAdminPlansQuery,
    usePriceListQuery,
    useProductsQuery,
    usePublishPriceListMutation,
    useSetPriceListEntriesMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    channelKey,
    displayName,
    isAgreementPriced,
    priceItemBaseKey,
    priceItemKey,
    summarisePriceEntries,
} from '../format.ts';
import {
    PriceEntryEditor,
    emptyPriceEntry,
    priceEntryDraft,
    priceEntryErrors,
    priceEntryRequest,
} from '../price-row-editors.tsx';
import type { PriceEntryDraft, PriceItemOption } from '../price-row-editors.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/price-lists/{priceList}` — what a list charges for, and whether it may charge it.
 *
 * ## There is no create form, and the currency is a fact rather than a field
 *
 * `KitchenAdminRepository` publishes no `createPriceList` and no `updatePriceList`. So this route
 * takes an identifier and only an identifier — `new` is not a value of it, unlike every other editor
 * in this workspace — and the header renders name, currency, kitchen and channels as **facts**. The
 * currency in particular is not a disabled field pretending it could be enabled: one list is one
 * currency (plan §4.4), every amount below is minor units *of that currency*, and there is no
 * request in this contract that could change it.
 *
 * ## One write, one lock version, one rule
 *
 * The whole screen is `setPriceListEntries` — a set-replace, so the array on screen is the array the
 * server will hold — plus `publishPriceList`. Both carry the `lockVersion` read at the moment of
 * saving; a stale one is a `resource.conflict` that {@link EditorFrame} turns into the reload-or-keep
 * question rather than an error page.
 *
 * The rule the editor exists to hold is the migration's `CHECK`: a confirmed price has an amount and
 * nothing else does. It is enforced live, per row, in `../price-row-editors.tsx` — switching a row's
 * status clears and disables the amount in the same gesture — and re-checked before the request is
 * built, because a draft can also arrive from the server.
 *
 * ## Publishing states what it does *not* do
 *
 * The dialog leads with the number of confirmed entries, because that is what publishing actually
 * makes chargeable, and says in as many words that placeholder and market-priced rows never reach a
 * customer (plan §2.4). A dialog that said "publish 40 prices" over a list with three numbers in it
 * would be the most expensive kind of true-sounding sentence in this programme.
 */

/* ------------------------------------------------------------------------------------------------
 * Item options
 * ---------------------------------------------------------------------------------------------- */

/** Yesterday-proof default for a brand-new row: today, in the ISO form the contract carries. */
function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface PriceListEditScreenProps {
    /** The route parameter. Always an identifier — this family has no create path. */
    readonly priceList: string | undefined;
}

export function PriceListEditScreen({ priceList }: PriceListEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-price-list-editor"
        >
            <PriceListEditor priceList={priceList} />
        </Gate>
    );
}

function PriceListEditor({ priceList }: PriceListEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const parsed = priceList === undefined ? null : PriceListId.safeParse(priceList);

    const record = usePriceListQuery(parsed);
    const products = useProductsQuery({ limit: 100 });
    const meals = useAdminMealsQuery({ limit: 100 });
    const plans = useAdminPlansQuery({ limit: 100 });

    const save = useSetPriceListEntriesMutation();
    const publish = usePublishPriceListMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [entries, setEntries] = useState<readonly PriceEntryDraft[]>([]);
    const [entriesKey, setEntriesKey] = useState<string | null>(null);
    const [entriesDirty, setEntriesDirty] = useState(false);
    const [nextEntryOrdinal, setNextEntryOrdinal] = useState(1);
    const [showPublish, setShowPublish] = useState(false);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's entries still in the form.
    if (data !== undefined && serverKey !== entriesKey && !entriesDirty) {
        setEntriesKey(serverKey);
        setEntries(
            data.entries.map((entry, index) => priceEntryDraft(entry, data.currency, index)),
        );
    }

    const markDirty = () => {
        setEntriesDirty(true);
        guard.markDirty();
    };

    const reload = useCallback(() => {
        setEntriesDirty(false);
        setEntriesKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const takeEntryKey = (): string => {
        const key = `entry-${String(nextEntryOrdinal)}`;
        setNextEntryOrdinal(nextEntryOrdinal + 1);
        return key;
    };

    /* ── the picker's catalogue ──────────────────────────────────────────────────────────────── */

    /**
     * Everything this kitchen can put a price on, from the three families the contract's
     * `CatalogueItemRef` names — and nothing else, because nothing else is expressible.
     *
     * Scoped to the list's own kitchen: a price list belongs to one `kitchenId`, and offering
     * another kitchen's meals would build a reference the server has no reason to accept. Products
     * carry their packs, plans carry their variants plus the plan itself, and a meal carries
     * neither, which is exactly the shape the second picker reads.
     */
    const itemOptions: readonly PriceItemOption[] = useMemo(() => {
        if (data === undefined) return [];
        const kitchenId = data.kitchenId;

        const productOptions = productsFromPages(products.data?.pages)
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => {
                const packs = row.packVariants;
                const first = packs[0] ?? null;
                return {
                    key: priceItemBaseKey({
                        kind: 'product',
                        productId: row.id,
                        packCode: null,
                    }),
                    kind: 'product',
                    label: displayName(row.name, locale).value,
                    defaultItem: {
                        kind: 'product',
                        productId: row.id,
                        packCode: first?.code ?? null,
                    },
                    variants: packs.map((pack) => ({
                        key: priceItemKey({
                            kind: 'product',
                            productId: row.id,
                            packCode: pack.code,
                        }),
                        label: `${pack.code} — ${displayName(pack.label, locale).value}`,
                        item: { kind: 'product', productId: row.id, packCode: pack.code },
                    })),
                };
            });

        const mealOptions = mealsFromPages(meals.data?.pages)
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => ({
                key: priceItemBaseKey({ kind: 'meal', mealId: row.id }),
                kind: 'meal',
                label: displayName(row.name, locale).value,
                defaultItem: { kind: 'meal', mealId: row.id },
                variants: [],
            }));

        const planOptions = plansFromPages(plans.data?.pages)
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => ({
                key: priceItemBaseKey({ kind: 'plan', planId: row.id, variantId: null }),
                kind: 'plan',
                label: displayName(row.name, locale).value,
                defaultItem: { kind: 'plan', planId: row.id, variantId: null },
                variants: [
                    {
                        key: priceItemKey({ kind: 'plan', planId: row.id, variantId: null }),
                        label: t('kitchen:priceLists.wholePlan'),
                        item: { kind: 'plan', planId: row.id, variantId: null },
                    },
                    ...row.variants.map((variant) => ({
                        key: priceItemKey({
                            kind: 'plan',
                            planId: row.id,
                            variantId: variant.id,
                        }),
                        label: displayName(variant.name, locale).value,
                        item: {
                            kind: 'plan' as const,
                            planId: row.id,
                            variantId: variant.id,
                        },
                    })),
                ],
            }));

        return [...productOptions, ...mealOptions, ...planOptions];
    }, [data, products.data, meals.data, plans.data, locale, t]);

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const currency = data?.currency ?? 'USD';

    const rowErrors = useMemo(
        () =>
            priceEntryErrors(entries, currency, {
                itemRequired: t('kitchen:priceLists.itemRequired'),
                itemDuplicate: t('kitchen:priceLists.itemDuplicate'),
                amountRequired: t('kitchen:priceLists.amountRequired'),
                amountInvalid: t('kitchen:priceLists.amountInvalid'),
                datesReversed: t('kitchen:priceLists.datesReversed'),
            }),
        [entries, currency, t],
    );

    const saveBlocked = rowErrors.size > 0;

    /**
     * The live summary of what is on screen — not of what the server holds.
     *
     * Deliberately computed from the draft rather than from `data.entries`: the counts are how a
     * person checks their own work before saving, and a summary that only moved after a round trip
     * would answer a question nobody asked.
     */
    const draftSummary = useMemo(
        () => summarisePriceEntries(priceEntryRequest(entries, currency)),
        [entries, currency],
    );

    /** What the server currently holds — the numbers publishing would actually make chargeable. */
    const savedSummary = useMemo(
        () => (data === undefined ? null : summarisePriceEntries(data.entries)),
        [data],
    );

    /**
     * Everything standing between this list and a published one.
     *
     * Unsaved changes are a blocker for the reason every other editor here gives: publishing
     * publishes what the server holds, not what is on screen. An inconsistent saved row is the
     * structural one — `publishPriceList` refuses it — and it is listed separately because clearing
     * it is a different action from saving.
     */
    const publishBlockers = useMemo(() => {
        if (data === undefined || savedSummary === null) return [];
        const reasons: string[] = [];
        if (entriesDirty) reasons.push(t('kitchen:priceLists.blockUnsaved'));
        if (savedSummary.total === 0) reasons.push(t('kitchen:priceLists.blockNoEntries'));
        if (savedSummary.inconsistent > 0) {
            reasons.push(
                t('kitchen:priceLists.blockInconsistent', { count: savedSummary.inconsistent }),
            );
        }
        return reasons;
    }, [data, savedSummary, entriesDirty, t]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveEntries = () => {
        if (saveBlocked || data === undefined) return;

        save.mutate(
            {
                priceListId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    entries: priceEntryRequest(entries, data.currency),
                },
            },
            {
                onSuccess: (saved) => {
                    setEntriesDirty(false);
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-price-list-saved-toast',
                        tone: 'success',
                        message: t('kitchen:priceLists.savedToast', {
                            count: saved.entries.length,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── refusal and not-found ───────────────────────────────────────────────────────────────── */

    if (parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-price-list-editor-screen">
                <Callout
                    testID="kitchen-price-list-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:priceLists.notFoundTitle')}
                    body={t('kitchen:priceLists.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-price-list-not-found-back"
                            variant="secondary"
                            label={t('kitchen:priceLists.backToList')}
                            onPress={() => {
                                router.push('/kitchen/price-lists' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (record.isPending) {
        return (
            <Stack space="md" testID="kitchen-price-list-editor-loading">
                <Skeleton testID="kitchen-price-list-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-price-list-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-price-list-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-price-list-editor-screen">
                <ErrorState
                    testID="kitchen-price-list-load-error"
                    failure={loadFailure}
                    title={t('kitchen:priceLists.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    if (data === undefined) return null;

    const saveFailure = toFailure(save.error);
    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishRefusedByEntries = Object.keys(publishFields).includes('entries');
    const quarantined = data.meta.status === 'review_required';
    const isPublished = data.meta.status === 'published';
    const confidential = isAgreementPriced(data.channels);

    return (
        <EditorFrame
            testID="kitchen-price-list-editor-screen"
            title={displayName(data.name, locale).value}
            meta={data.meta}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveEntries}
            saveLabel={t('kitchen:priceLists.saveEntries')}
            saving={save.isPending}
            saveDisabled={!canManage || saveBlocked}
            backLabel={t('kitchen:priceLists.backToList')}
            onBack={() => {
                router.push('/kitchen/price-lists' as never);
            }}
            primaryAction={
                !canManage || isPublished ? null : (
                    <Button
                        testID="kitchen-price-list-publish"
                        variant="secondary"
                        label={t('kitchen:publish.action')}
                        onPress={() => {
                            setShowPublish(true);
                        }}
                    />
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-price-list-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {isPublished ? (
                        <Callout
                            testID="kitchen-price-list-published"
                            role="note"
                            tone="success"
                            title={t('kitchen:priceLists.publishedTitle')}
                            body={t('kitchen:priceLists.publishedBody')}
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-price-list-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:priceLists.saveFailedTitle')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── the facts the contract makes read-only ───────────────────────────────────── */}
            <Card testID="kitchen-price-list-facts" padding="md">
                <Stack space="sm">
                    <Heading level={2}>{t('kitchen:priceLists.factsTitle')}</Heading>

                    <Inline space="sm" wrap testID="kitchen-price-list-currency">
                        <Text variant="label">{t('kitchen:priceLists.currencyLabel')}</Text>
                        <Badge tone="neutral" label={data.currency} />
                    </Inline>

                    <Stack space="xs">
                        <Text variant="label">{t('kitchen:priceLists.channelsLabel')}</Text>
                        {data.channels.length === 0 ? (
                            <Text
                                testID="kitchen-price-list-channels-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:priceLists.noChannels')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap testID="kitchen-price-list-channels">
                                {data.channels.map((channel) => (
                                    <Badge
                                        key={channel}
                                        testID={`kitchen-price-list-channel-${channel}`}
                                        tone="info"
                                        label={t(channelKey(channel))}
                                    />
                                ))}
                            </Inline>
                        )}
                    </Stack>

                    <Text
                        testID="kitchen-price-list-readonly-note"
                        variant="caption"
                        tone="secondary"
                    >
                        {t('kitchen:priceLists.readOnlyNote')}
                    </Text>
                </Stack>
            </Card>

            {/*
             * Confidential treatment: a raised card and a note, on the list whose prices are
             * negotiated inside one buyer relationship. It sits above the entries rather than beside
             * the name, because the thing that must not leak is the *numbers* below it.
             */}
            {confidential ? (
                <View
                    testID="kitchen-price-list-confidential"
                    role="note"
                    className="rounded-lg border border-stroke-subtle bg-surface-raised p-3"
                >
                    <Stack space="xs">
                        <Inline space="xs" align="center" wrap>
                            <Badge
                                testID="kitchen-price-list-agreement"
                                tone="warning"
                                icon="eye"
                                label={t('kitchen:priceLists.agreementBadge')}
                            />
                            <Text variant="label">{t('kitchen:priceLists.confidentialTitle')}</Text>
                        </Inline>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:priceLists.confidentialBody')}
                        </Text>
                    </Stack>
                </View>
            ) : null}

            {/* ── entries ──────────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-price-list-entries-card" padding="md">
                <Stack space="md">
                    <Stack space="xs">
                        <Heading level={2}>{t('kitchen:priceLists.entriesTitle')}</Heading>
                        <Text tone="secondary" variant="caption">
                            {t('kitchen:priceLists.entriesHelp')}
                        </Text>
                    </Stack>

                    <Inline space="xs" wrap testID="kitchen-price-list-draft-summary">
                        <Badge
                            testID="kitchen-price-list-draft-confirmed"
                            tone={draftSummary.confirmed === 0 ? 'neutral' : 'success'}
                            label={t('kitchen:priceLists.confirmedCount', {
                                count: draftSummary.confirmed,
                            })}
                        />
                        <Badge
                            testID="kitchen-price-list-draft-placeholder"
                            tone={draftSummary.placeholder === 0 ? 'neutral' : 'warning'}
                            label={t('kitchen:priceLists.placeholderCount', {
                                count: draftSummary.placeholder,
                            })}
                        />
                        <Badge
                            testID="kitchen-price-list-draft-market"
                            tone="info"
                            label={t('kitchen:priceLists.marketCount', {
                                count: draftSummary.marketPriced,
                            })}
                        />
                    </Inline>

                    <PriceEntryEditor
                        testID="kitchen-price-list-entries"
                        rows={entries}
                        errors={rowErrors}
                        options={itemOptions}
                        currency={data.currency}
                        canManage={canManage}
                        onChange={(next) => {
                            setEntries(next);
                            markDirty();
                        }}
                    />

                    {canManage ? (
                        <Inline space="sm" wrap>
                            <Button
                                testID="kitchen-price-list-add-entry"
                                variant="secondary"
                                label={t('kitchen:priceLists.addEntry')}
                                onPress={() => {
                                    setEntries([
                                        ...entries,
                                        emptyPriceEntry(takeEntryKey(), todayIso()),
                                    ]);
                                    markDirty();
                                }}
                            />
                        </Inline>
                    ) : null}
                </Stack>
            </Card>

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-price-list-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:priceLists.publishTitle')}
                description={t('kitchen:priceLists.publishBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-price-list-publish-cancel"
                            variant="secondary"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-price-list-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                publish.mutate(
                                    {
                                        priceListId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowPublish(false);
                                            toast.show({
                                                testID: 'kitchen-price-list-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:priceLists.publishedToast', {
                                                    name: displayName(data.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    {/*
                     * The consequence, stated as a count rather than as a verb. `savedSummary` and
                     * not the draft: publishing publishes what the server holds.
                     */}
                    <Text testID="kitchen-price-list-publish-consequence">
                        {t('kitchen:priceLists.publishConsequence', {
                            count: savedSummary?.confirmed ?? 0,
                        })}
                    </Text>

                    <Callout
                        testID="kitchen-price-list-publish-excluded"
                        role="note"
                        tone="warning"
                        title={t('kitchen:priceLists.publishExcludedTitle')}
                        body={t('kitchen:priceLists.publishExcludedBody', {
                            placeholders: savedSummary?.placeholder ?? 0,
                            market: savedSummary?.marketPriced ?? 0,
                        })}
                    />

                    {confidential ? (
                        <Callout
                            testID="kitchen-price-list-publish-confidential"
                            role="note"
                            tone="warning"
                            title={t('kitchen:priceLists.agreementBadge')}
                            body={t('kitchen:priceLists.confidentialBody')}
                        />
                    ) : null}

                    {quarantined ? (
                        <Callout
                            testID="kitchen-price-list-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-price-list-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:priceLists.publishBlockedTitle')}
                        >
                            <Stack space="xs">
                                {publishBlockers.map((reason) => (
                                    <Text key={reason} variant="caption">
                                        {reason}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}

                    {publishFailure === null ? null : (
                        <Text testID="kitchen-price-list-publish-error" tone="danger">
                            {publishRefusedByEntries
                                ? t('kitchen:priceLists.publishRefusedEntries')
                                : publishFailure.message}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </EditorFrame>
    );
}
