import { isValidationFailure } from '@healthy360/api-client/contracts';
import type { ChannelAvailability } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    ErrorState,
    FormIssueScope,
    FormSkeleton,
    Icon,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { FormIssueItem } from '@healthy360/design-system';
import { PriceListId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
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
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import {
    channelKey,
    displayName,
    isAgreementPriced,
    priceItemBaseKey,
    priceItemKey,
    statusKey,
    statusTone,
    summarisePriceEntries,
} from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    PriceEntriesCard,
    emptyPriceEntry,
    priceEntryDraft,
    priceEntryName,
    priceEntryProblems,
    priceEntryRequest,
    priceProblemField,
    pricedThingName,
    summarisePriceChanges,
    uncoveredUnits,
    usePriceProblemText,
} from '../price-row-editors.tsx';
import type { PriceEntryDraft, PriceEntryProblem, PriceItemOption } from '../price-row-editors.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/price-lists/{priceList}` — what a list charges for, and whether it may charge it.
 *
 * `Price List.dc.html` (design_handoff_kitchen_forms §4): one page of entries, opened by the list's
 * fixed facts and closed by a save bar that appears only when something has changed.
 *
 * ## There is no create form, and the currency is a fact rather than a field
 *
 * `KitchenAdminRepository` publishes no `createPriceList` and no `updatePriceList`. So this route
 * takes an identifier and only an identifier, and the opening states currency, kitchen and channels
 * as **facts** with a *Fixed* tag: one list is one currency (plan §4.4), every amount below is minor
 * units *of that currency*, and no request in this contract could change it.
 *
 * ## The page, top to bottom
 *
 * - **The opening**: the name, its status and when it last changed, the facts, *Back to price
 *   lists* and — on a list not yet published — *Publish*. Once a save has been refused, the error
 *   summary lists each entry that stopped it, and each chip takes the reader to the row.
 * - **Notices**: offline, a draft's "Not charged yet", the quarantine and the confidential rates.
 * - **The missing-items bar**: what is on sale on this list's channels and has no entry, with *Add
 *   them as pending* — rows that keep the item from being forgotten without inventing a price.
 * - **The entries** (`../price-row-editors.tsx`): filter, search, bulk change, the grouped grid.
 * - **The save bar**, sticky at the foot of the page while anything differs from the saved list:
 *   how many changes, what saving does to customers, *Discard changes* and the save.
 *
 * ## One write, one lock version, one rule
 *
 * The whole screen is `setPriceListEntries` — a set-replace, so the array on screen is the array the
 * server will hold — plus `publishPriceList`. Both carry the `lockVersion` read at the moment of
 * saving; a stale one is a `resource.conflict` that becomes the reload-or-keep question.
 *
 * Validation runs when Save is pressed, not on every keystroke: a row half-typed is not yet wrong.
 * From then on it follows the edits, so a fixed row loses its tint as it is fixed.
 *
 * ## Publishing states what it does *not* do
 *
 * *Publish* waits for unsaved changes to be saved — publishing publishes what the server holds —
 * and its dialog leads with the number of confirmed entries, because that is what publishing makes
 * chargeable, and says that Pending and Daily rows never reach a customer (plan §2.4).
 */

/** Yesterday-proof default for a brand-new row: today, in the ISO form the contract carries. */
function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

const NO_PROBLEMS: ReadonlyMap<string, readonly PriceEntryProblem[]> = new Map();

/** How many missing items the bar names before it says "and N more". */
const GAP_NAMES_SHOWN = 4;

const BOOK_ROUTE = '/kitchen/price-lists';
const PAGE_ID = 'kitchen-price-list';
const SCREEN_ID = 'kitchen-price-list-editor-screen';

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
            <FormIssueScope>
                <PriceListEditor priceList={priceList} />
            </FormIssueScope>
        </Gate>
    );
}

function PriceListEditor({ priceList }: PriceListEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const { me } = useSession();
    const { online } = useOnlineStatus();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const parsed = priceList === undefined ? null : PriceListId.safeParse(priceList);

    const record = usePriceListQuery(parsed);
    /*
     * The catalogue, asked for only once the list itself has arrived. The six reads are the
     * heaviest on the page and only name the rows and fill the picker; sent alongside the list they
     * took the server's workers first and the page sat on its skeleton behind them.
     *
     * Sauces, dressings and frozen meals are priced as products — same packs, same pricing — but
     * each is its own item type on the wire, so each is listed on its own.
     */
    const catalogueWanted = record.data !== undefined;
    const products = useProductsQuery({ limit: 100 }, catalogueWanted);
    const sauces = useProductsQuery({ limit: 100, itemType: 'sauce' }, catalogueWanted);
    const dressings = useProductsQuery({ limit: 100, itemType: 'dressing' }, catalogueWanted);
    const frozenMeals = useProductsQuery({ limit: 100, itemType: 'frozen_meal' }, catalogueWanted);
    const meals = useAdminMealsQuery({ limit: 100 }, catalogueWanted);
    const plans = useAdminPlansQuery({ limit: 100 }, catalogueWanted);
    const catalogueReads = [products, sauces, dressings, frozenMeals, meals, plans];
    const catalogueResolving = catalogueReads.some((read) => read.isPending);

    const save = useSetPriceListEntriesMutation();
    const publish = usePublishPriceListMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [entries, setEntries] = useState<readonly PriceEntryDraft[]>([]);
    const [baseline, setBaseline] = useState<ReadonlyMap<string, PriceEntryDraft>>(() => new Map());
    const [entriesKey, setEntriesKey] = useState<string | null>(null);
    const [nextEntryOrdinal, setNextEntryOrdinal] = useState(1);
    const [submitted, setSubmitted] = useState(false);
    const [showPublish, setShowPublish] = useState(false);

    const data = record.data;
    const currency = data?.currency ?? 'USD';
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    const seed = (list: NonNullable<typeof data>) => {
        const seeded = list.entries.map((entry, index) =>
            priceEntryDraft(entry, list.currency, index),
        );
        setEntries(seeded);
        setBaseline(new Map(seeded.map((row) => [row.key, row])));
    };

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's entries still in the grid.
    if (data !== undefined && serverKey !== entriesKey && !guard.isDirty) {
        setEntriesKey(serverKey);
        seed(data);
    }

    const title =
        data === undefined
            ? t('kitchen:priceLists.viewKind')
            : displayName(data.name, locale).value;
    useKitchenTrailLeaf(data === undefined ? null : title);

    const changes = useMemo(
        () => summarisePriceChanges(entries, baseline, currency),
        [entries, baseline, currency],
    );

    /** Every edit goes through here, so the guard is dirty exactly while the save bar shows. */
    const applyRows = (next: readonly PriceEntryDraft[]) => {
        setEntries(next);
        if (summarisePriceChanges(next, baseline, currency).total > 0) guard.markDirty();
        else guard.markClean();
    };

    const reload = useCallback(() => {
        setEntriesKey(null);
        setSubmitted(false);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── the catalogue, as what can be priced ──────────────────────────────────────────────── */

    /**
     * Everything this kitchen can put a price on, from the three families the contract's
     * `CatalogueItemRef` names — and nothing else, because nothing else is expressible. Scoped to
     * the list's own kitchen: offering another kitchen's meals would build a reference the server
     * has no reason to accept.
     *
     * *On sale* is what the missing-items bar counts: published, and available on one of the
     * list's own channels. A plan carries no channel availability in this contract, so a published
     * plan counts as on sale wherever its kitchen's list is.
     */
    const itemOptions: readonly PriceItemOption[] = useMemo(() => {
        if (data === undefined) return [];
        const kitchenId = data.kitchenId;
        const channels = data.channels;
        const soldHere = (availability: readonly ChannelAvailability[]) =>
            availability.some((row) => row.isAvailable && channels.includes(row.channel));

        // One row per article however many of the four reads returned it.
        const productRows = new Map(
            [
                ...productsFromPages(products.data?.pages),
                ...productsFromPages(sauces.data?.pages),
                ...productsFromPages(dressings.data?.pages),
                ...productsFromPages(frozenMeals.data?.pages),
            ].map((row) => [String(row.id), row]),
        );
        const productOptions = [...productRows.values()]
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => {
                const whole = { kind: 'product' as const, productId: row.id, packCode: null };
                return {
                    key: priceItemBaseKey(whole),
                    kind: 'product',
                    group: row.itemType,
                    label: displayName(row.name, locale).value,
                    code: row.reference,
                    defaultItem: whole,
                    variants: row.packVariants.map((pack) => {
                        const item = {
                            kind: 'product' as const,
                            productId: row.id,
                            packCode: pack.code,
                        };
                        return {
                            key: priceItemKey(item),
                            label: displayName(pack.label, locale).value,
                            item,
                        };
                    }),
                    onSale: row.meta.status === 'published' && soldHere(row.channelAvailability),
                };
            });

        const mealOptions = mealsFromPages(meals.data?.pages)
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => {
                const item = { kind: 'meal' as const, mealId: row.id };
                return {
                    key: priceItemBaseKey(item),
                    kind: 'meal',
                    group: 'meal',
                    label: displayName(row.name, locale).value,
                    code: null,
                    defaultItem: item,
                    variants: [],
                    onSale: row.meta.status === 'published' && soldHere(row.channelAvailability),
                };
            });

        const planOptions = plansFromPages(plans.data?.pages)
            .filter((row) => row.kitchenId === kitchenId)
            .map<PriceItemOption>((row) => {
                const whole = { kind: 'plan' as const, planId: row.id, variantId: null };
                return {
                    key: priceItemBaseKey(whole),
                    kind: 'plan',
                    group: 'plan',
                    label: displayName(row.name, locale).value,
                    code: null,
                    defaultItem: whole,
                    variants: [
                        {
                            key: priceItemKey(whole),
                            label: t('kitchen:priceLists.packPlan'),
                            item: whole,
                            whole: true,
                        },
                        ...row.variants.map((variant) => {
                            const item = {
                                kind: 'plan' as const,
                                planId: row.id,
                                variantId: variant.id,
                            };
                            return {
                                key: priceItemKey(item),
                                label: displayName(variant.name, locale).value,
                                item,
                            };
                        }),
                    ],
                    onSale: row.meta.status === 'published',
                };
            });

        return [...productOptions, ...mealOptions, ...planOptions];
    }, [
        data,
        products.data,
        sauces.data,
        dressings.data,
        frozenMeals.data,
        meals.data,
        plans.data,
        locale,
        t,
    ]);

    const byKey = useMemo(
        () => new Map(itemOptions.map((option) => [option.key, option])),
        [itemOptions],
    );

    const nameOf = (row: PriceEntryDraft): string =>
        priceEntryName(row, byKey, {
            unchosen: t('kitchen:priceLists.newEntry'),
            unknown: t('kitchen:priceLists.unknownItem'),
        });

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const problems = useMemo(() => priceEntryProblems(entries, currency), [entries, currency]);
    const shownProblems = submitted ? problems : NO_PROBLEMS;
    const problemText = usePriceProblemText(currency);

    const issueItems: readonly FormIssueItem[] = entries.flatMap((row) => {
        const first = shownProblems.get(row.key)?.[0];
        if (first === undefined) return [];
        const name = nameOf(row);
        const rowId = `${PAGE_ID}-entries-row-${row.key}`;
        const field = priceProblemField(first);
        // The field the chip names takes the message; dates have no single field to name.
        const fieldId =
            field === 'item' ? `${rowId}-item` : field === 'amount' ? `${rowId}-amount` : undefined;
        return [
            {
                key: row.key,
                label: t('kitchen:priceLists.issueChip', {
                    name,
                    problem: problemText(first, name),
                }),
                fieldId,
                onPress: () => {
                    focusField(fieldId ?? rowId);
                },
            },
        ];
    });

    /* ── what is on sale and not on the list ─────────────────────────────────────────────── */

    const gaps = useMemo(
        () => (catalogueResolving ? [] : uncoveredUnits(itemOptions, entries)),
        [catalogueResolving, itemOptions, entries],
    );

    const addGaps = () => {
        let ordinal = nextEntryOrdinal;
        const added = gaps.map((unit) => ({
            ...emptyPriceEntry(`entry-${String(ordinal++)}`, todayIso()),
            item: unit.item,
            priceStatus: 'placeholder' as const,
        }));
        setNextEntryOrdinal(ordinal);
        applyRows([...entries, ...added]);
        toast.show({
            testID: `${PAGE_ID}-gaps-added-toast`,
            tone: 'success',
            message: t('kitchen:priceLists.gapAddedToast', { count: added.length }),
        });
    };

    /* ── what the server holds ───────────────────────────────────────────────────────────── */

    /** The numbers publishing would actually make chargeable. */
    const savedSummary = useMemo(
        () => (data === undefined ? null : summarisePriceEntries(data.entries)),
        [data],
    );

    /**
     * Everything standing between this list and a published one. Unsaved changes are a blocker
     * because publishing publishes what the server holds, not what is on screen.
     */
    const publishBlockers = useMemo(() => {
        if (data === undefined || savedSummary === null) return [];
        const reasons: string[] = [];
        if (guard.isDirty) reasons.push(t('kitchen:priceLists.blockUnsaved'));
        if (savedSummary.total === 0) reasons.push(t('kitchen:priceLists.blockNoEntries'));
        if (savedSummary.inconsistent > 0) {
            reasons.push(
                t('kitchen:priceLists.blockInconsistent', { count: savedSummary.inconsistent }),
            );
        }
        return reasons;
    }, [data, savedSummary, guard.isDirty, t]);

    const kitchenName = useMemo(() => {
        if (data === undefined) return null;
        const id = String(data.kitchenId);
        for (const membership of me?.memberships ?? []) {
            const branch = membership.branches.find((candidate) => String(candidate.id) === id);
            if (branch !== undefined) return branch.name;
            if (String(membership.organisation.id) === id) return membership.organisation.name;
        }
        return null;
    }, [data, me]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const isPublished = data?.meta.status === 'published';

    const attemptSave = () => {
        if (data === undefined || !online) return;
        setSubmitted(true);
        if (problems.size > 0) return;

        save.mutate(
            {
                priceListId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    entries: priceEntryRequest(entries, data.currency),
                },
            },
            {
                onSuccess: () => {
                    setSubmitted(false);
                    guard.markClean();
                    toast.show({
                        testID: `${PAGE_ID}-saved-toast`,
                        tone: 'success',
                        message: isPublished
                            ? t('kitchen:priceLists.savedToastPublished')
                            : t('kitchen:priceLists.savedToastDraft'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const discard = () => {
        if (data === undefined) return;
        seed(data);
        setSubmitted(false);
        save.reset();
        guard.markClean();
        toast.show({
            testID: `${PAGE_ID}-discarded-toast`,
            tone: 'neutral',
            message: t('kitchen:priceLists.discardedToast'),
        });
    };

    const backToBook = () => {
        router.push(BOOK_ROUTE as never);
    };

    /* ── refusal and not-found ───────────────────────────────────────────────────────────────── */

    if (parsed === null) {
        return (
            <Stack space="lg" testID={SCREEN_ID}>
                <Callout
                    testID={`${PAGE_ID}-not-found`}
                    role="alert"
                    tone="warning"
                    title={t('kitchen:priceLists.notFoundTitle')}
                    body={t('kitchen:priceLists.notFoundBody')}
                    actions={
                        <Button
                            testID={`${PAGE_ID}-not-found-back`}
                            variant="quiet"
                            label={t('kitchen:priceLists.backToList')}
                            onPress={backToBook}
                        />
                    }
                />
            </Stack>
        );
    }

    if (record.isPending) {
        return (
            <Stack space="sm">
                <FormSkeleton
                    testID="kitchen-price-list-editor-loading"
                    partTestID={PAGE_ID}
                    sections={2}
                />
                <Text variant="caption" tone="secondary">
                    {t('kitchen:priceLists.loadingNote')}
                </Text>
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID={SCREEN_ID}>
                <ErrorState
                    testID={`${PAGE_ID}-load-error`}
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
    const confidential = isAgreementPriced(data.channels);

    const changedOn =
        data.meta.updatedAt === ''
            ? null
            : formatter.formatDate(data.meta.updatedAt, {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
              });
    const statusMeta = isPublished
        ? changedOn === null
            ? t('kitchen:priceLists.metaPublishedUndated')
            : t('kitchen:priceLists.metaPublished', { date: changedOn })
        : changedOn === null
          ? t('kitchen:priceLists.metaDraftUndated')
          : t('kitchen:priceLists.metaDraft', { date: changedOn });

    const channelNames =
        data.channels.length === 0
            ? t('kitchen:priceLists.noChannels')
            : data.channels.map((channel) => t(channelKey(channel))).join(', ');

    const gapNames = gaps.slice(0, GAP_NAMES_SHOWN).map(pricedThingName).join(', ');
    const gapBody =
        gaps.length > GAP_NAMES_SHOWN
            ? t('kitchen:priceLists.gapBodyMore', {
                  names: gapNames,
                  count: gaps.length - GAP_NAMES_SHOWN,
                  channels: channelNames,
              })
            : t('kitchen:priceLists.gapBody', { names: gapNames, channels: channelNames });

    const changeParts = [
        changes.edited > 0
            ? t('kitchen:priceLists.changesEdited', { count: changes.edited })
            : null,
        changes.added > 0 ? t('kitchen:priceLists.changesAdded', { count: changes.added }) : null,
        changes.removed > 0
            ? t('kitchen:priceLists.changesRemoved', { count: changes.removed })
            : null,
    ]
        .filter((part): part is string => part !== null)
        .join(' · ');

    const readAt = formatter.formatDate(new Date(record.dataUpdatedAt), {
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <Stack space="md" testID={SCREEN_ID}>
            <RecordFormOpening
                testID={SCREEN_ID}
                title={title}
                dirty={false}
                badges={
                    <>
                        <Badge
                            testID={`${PAGE_ID}-status`}
                            tone={statusTone(data.meta.status)}
                            label={t(statusKey(data.meta.status))}
                        />
                        <Text testID={`${PAGE_ID}-status-meta`} variant="caption" tone="secondary">
                            {statusMeta}
                        </Text>
                    </>
                }
                details={
                    <View
                        testID={`${PAGE_ID}-facts`}
                        className="flex-row flex-wrap items-center gap-x-snug gap-y-1.5"
                    >
                        <Fact
                            testID={`${PAGE_ID}-fact-currency`}
                            label={t('kitchen:priceLists.currencyLabel')}
                            value={data.currency}
                        />
                        {kitchenName === null ? null : (
                            <Fact
                                testID={`${PAGE_ID}-fact-kitchen`}
                                label={t('kitchen:priceLists.kitchenLabel')}
                                value={kitchenName}
                            />
                        )}
                        <Fact
                            testID={`${PAGE_ID}-fact-channels`}
                            label={t('kitchen:priceLists.channelsLabel')}
                            value={channelNames}
                        />
                        <View
                            testID={`${PAGE_ID}-fixed`}
                            accessibilityHint={t('kitchen:priceLists.fixedHint')}
                            // The design's tooltip. The same words reach a screen reader as the hint.
                            {...({ title: t('kitchen:priceLists.fixedHint') } as object)}
                            className="h-5 flex-row items-center gap-1 rounded-sm bg-surface-sunken px-1.5"
                        >
                            <Icon name="lock" size="sm" className="text-content-secondary" />
                            <Text variant="micro" tone="secondary" className="uppercase">
                                {t('kitchen:priceLists.fixedTag')}
                            </Text>
                        </View>
                    </View>
                }
                actions={
                    <>
                        <Button
                            testID={`${SCREEN_ID}-back`}
                            variant="secondary"
                            label={t('kitchen:priceLists.backToList')}
                            onPress={() => {
                                guard.intercept(backToBook);
                            }}
                        />
                        {isPublished || !canManage ? null : (
                            <Button
                                testID={`${PAGE_ID}-publish`}
                                label={t('kitchen:priceLists.publish')}
                                disabled={guard.isDirty || !online || quarantined}
                                onPress={() => {
                                    setShowPublish(true);
                                }}
                            />
                        )}
                    </>
                }
                errors={{
                    summary: t('kitchen:priceLists.issuesTitle', { count: issueItems.length }),
                    items: issueItems,
                }}
            />

            {online ? null : (
                <Callout
                    testID={`${PAGE_ID}-offline`}
                    role="status"
                    tone="warning"
                    title={t('kitchen:priceLists.offlineTitle')}
                    body={t('kitchen:priceLists.offlineBody', { time: readAt })}
                />
            )}

            {quarantined ? (
                <Callout
                    testID={`${PAGE_ID}-quarantine`}
                    role="alert"
                    tone="warning"
                    title={t('kitchen:publish.quarantineTitle')}
                    body={t('kitchen:publish.quarantineBody')}
                />
            ) : isPublished ? null : (
                <Callout
                    testID={`${PAGE_ID}-draft-note`}
                    role="note"
                    tone="warning"
                    title={t('kitchen:priceLists.draftNoteTitle')}
                    body={t('kitchen:priceLists.draftNoteBody')}
                />
            )}

            {confidential ? (
                <Callout
                    testID={`${PAGE_ID}-confidential`}
                    role="note"
                    tone="warning"
                    title={t('kitchen:priceLists.confidentialTitle')}
                    body={t('kitchen:priceLists.confidentialBody')}
                />
            ) : null}

            {saveFailure === null ? null : (
                <Callout
                    testID={`${PAGE_ID}-save-error`}
                    role="alert"
                    tone="danger"
                    title={t('kitchen:priceLists.saveFailedTitle')}
                    body={saveFailure.message}
                />
            )}

            {gaps.length === 0 || entries.length === 0 ? null : (
                <View
                    testID={`${PAGE_ID}-gaps`}
                    className="flex-row flex-wrap items-center gap-snug rounded border border-stroke-subtle bg-surface-raised px-snug py-2.5"
                >
                    <Icon name="tag" size="sm" className="text-warning-strong" />
                    <View className="min-w-0 flex-1 gap-0.5" style={{ flexBasis: 300 }}>
                        <Text testID={`${PAGE_ID}-gaps-title`} variant="strong">
                            {t('kitchen:priceLists.gapTitle', { count: gaps.length })}
                        </Text>
                        <Text testID={`${PAGE_ID}-gaps-names`} tone="secondary">
                            {gapBody}
                        </Text>
                    </View>
                    {canManage ? (
                        <Button
                            testID={`${PAGE_ID}-gaps-add`}
                            variant="secondary"
                            label={t('kitchen:priceLists.gapAdd')}
                            onPress={addGaps}
                        />
                    ) : null}
                </View>
            )}

            <PriceEntriesCard
                testID={PAGE_ID}
                rows={entries}
                onChange={applyRows}
                onAdd={() => {
                    const key = `entry-${String(nextEntryOrdinal)}`;
                    setNextEntryOrdinal(nextEntryOrdinal + 1);
                    applyRows([...entries, emptyPriceEntry(key, todayIso())]);
                }}
                baseline={baseline}
                problems={shownProblems}
                options={itemOptions}
                currency={data.currency}
                canManage={canManage}
                resolving={catalogueResolving}
            />

            {/* ── the save bar ───────────────────────────────────────────────────────────────── */}
            {changes.total === 0 || !canManage ? null : (
                <View
                    testID={`${PAGE_ID}-save-bar`}
                    className="z-sticky flex-row flex-wrap items-center gap-snug rounded border border-stroke-subtle bg-surface-raised px-base py-snug shadow-elevation-3 web:sticky web:bottom-0"
                >
                    <View className="min-w-0 flex-1 gap-0.5" style={{ flexBasis: 320 }}>
                        <Text testID={`${PAGE_ID}-changes-title`} variant="strong">
                            {t('kitchen:priceLists.changesTitle', { count: changes.total })}
                        </Text>
                        <Text testID={`${PAGE_ID}-changes-body`} tone="secondary">
                            {isPublished
                                ? t('kitchen:priceLists.changesBodyPublished', {
                                      changes: changeParts,
                                  })
                                : t('kitchen:priceLists.changesBodyDraft', {
                                      changes: changeParts,
                                  })}
                        </Text>
                    </View>
                    <Button
                        testID={`${PAGE_ID}-discard`}
                        variant="secondary"
                        label={t('kitchen:priceLists.discardChanges')}
                        onPress={discard}
                    />
                    {/* The frame's own save id, so the guard and conflict flows find it. */}
                    <Button
                        testID={`${SCREEN_ID}-save`}
                        label={
                            isPublished
                                ? t('kitchen:priceLists.saveAndCharge')
                                : t('kitchen:priceLists.saveDraft')
                        }
                        loading={save.isPending}
                        disabled={!online || save.isPending}
                        onPress={attemptSave}
                    />
                </View>
            )}

            <EditorGuardDialogs guard={guard} concurrency={concurrency} testID={SCREEN_ID} />

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID={`${PAGE_ID}-publish-dialog`}
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:priceLists.publishTitle')}
                description={t('kitchen:priceLists.publishBody')}
                actions={
                    <>
                        <Button
                            testID={`${PAGE_ID}-publish-cancel`}
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID={`${PAGE_ID}-publish-confirm`}
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
                                                testID: `${PAGE_ID}-published-toast`,
                                                tone: 'success',
                                                message: t('kitchen:priceLists.publishedToast', {
                                                    name: title,
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
                    <Text testID={`${PAGE_ID}-publish-consequence`}>
                        {t('kitchen:priceLists.publishConsequence', {
                            count: savedSummary?.confirmed ?? 0,
                        })}
                    </Text>

                    <Callout
                        testID={`${PAGE_ID}-publish-excluded`}
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
                            testID={`${PAGE_ID}-publish-confidential`}
                            role="note"
                            tone="warning"
                            title={t('kitchen:priceLists.agreementBadge')}
                            body={t('kitchen:priceLists.confidentialBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID={`${PAGE_ID}-publish-blocked`}
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
                        <Text testID={`${PAGE_ID}-publish-error`} tone="danger">
                            {publishRefusedByEntries
                                ? t('kitchen:priceLists.publishRefusedEntries')
                                : publishFailure.message}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </Stack>
    );
}

/** One of the list's fixed facts: what it is, then its value. */
function Fact({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}) {
    return (
        <View testID={testID} className="flex-row items-baseline gap-1.5">
            <Text tone="secondary">{label}</Text>
            <Text testID={`${testID}-value`} variant="label">
                {value}
            </Text>
        </View>
    );
}
