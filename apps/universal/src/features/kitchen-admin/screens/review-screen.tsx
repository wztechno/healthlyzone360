import { apiFailure } from '@healthy360/api-client/contracts';
import {
    Button,
    Cascade,
    DatePickerButton,
    EmptyState,
    ErrorState,
    Stack,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReviewQueueQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, statusKey } from '../format.ts';
import { ReviewTable, useReviewColumns } from '../review/review-table.tsx';
import { buildReviewQueue, isBlocked, reviewFamilyKey, reviewReasonKey } from '../review-queue.ts';
import type { ReviewItem, ReviewQueue, ReviewSection } from '../review-queue.ts';
import { ColumnPicker } from '../catalogue/column-picker.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import { PeriodScope } from '../catalogue/period-scope.tsx';
import type { PeriodWindow } from '../catalogue/period-scope.tsx';
import { todayIso } from '../../commerce/dates.ts';
import type { LensFigure, LensMixPart } from '../catalogue/lens-bar.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { useListMemory, useRememberedFilter, useRememberedQuery } from '../list-memory.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';

/**
 * `/kitchen/review` — the publication review queue (K1.8), as `Workbench.dc.html` draws it.
 *
 * ```
 * (All 6) │ ● Blocked 1  ● To finish 5
 * [ ⌕ Item ]                                   6 of 6
 * ID        ITEM                WHY IT IS HERE          LAST CHANGED          ◉ ✎
 * ING-0142  …
 * RC-0007   …
 * ```
 *
 * ## The one screen in this workspace that is not about a family
 *
 * Every other kitchen screen answers "show me the ingredients". This one answers **what is stopping
 * anything from going out?** — a question across five families at once. They share one table, and
 * the ID column (`ING-`, `RC-`, `RSL-`, or the family's name where it has no series) says which
 * family a row is; its header filters by family.
 *
 * ## It states what it checked, and it never claims more
 *
 * The repository publishes no readiness verdict, so the reasons are derived in `../review-queue.ts`
 * and both footnotes — `review.scope` and `review.notChecked` — stay below the last section. They are
 * the screen's answer to "is this everything?". The all-clear prints the scope too: a green state over
 * an unstated check is the most expensive true-sounding sentence a management screen can print.
 *
 * ## Nothing is written from here
 *
 * No resolve, no publish-anyway, no bulk action. The row body opens the read-only record page, and
 * both its primary and the row's pen go to the family's own editor, where the lock version, the unsaved
 * guard and the publish confirmation already live.
 *
 * ## Last changed between, as Stock gaps draws it
 *
 * The Period shortcut and a From–To pair narrow the queue to records last changed in that window,
 * on the reader's own calendar. Either end may be open; All clears both. Show columns sits at the
 * bar's end, as on every Catalogue list.
 *
 * ## The figures count the searched queue
 *
 * All, Blocked and To finish are counted over the rows the search and window leave, the scope
 * aside, so both move them (§3z rule 1) and Blocked and To finish always add up to All. The result states
 * the whole queue — "of 6" — which is the one figure a filter should not move.
 */
export function ReviewScreen({ view }: { readonly view?: string | undefined }) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-review"
        >
            <ReviewQueueBody view={view} />
        </Gate>
    );
}

type ReviewScope = 'all' | 'blocked' | 'unblocked';

function ReviewQueueBody({ view }: { readonly view?: string | undefined }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const sources = useReviewQueueQuery();

    // Search and scope survive leaving the queue for a record and coming back to it.
    const memory = useListMemory('kitchen.review');
    const [search, setSearch] = useRememberedQuery(memory);
    const [scope, setScope] = useRememberedFilter<ReviewScope>(memory, 'scope', 'all');
    const [from, setFrom] = useRememberedFilter<string>(memory, 'from', '');
    const [to, setTo] = useRememberedFilter<string>(memory, 'to', '');
    const [today] = useState(() => todayIso());
    /*
     * The record whose page is open, by id — mirrored into `?view=` so the view is an address:
     * an editor opened from it comes back to it, and Back and a refresh keep it. Followed from the
     * param during render, so the browser's own Back closes it too.
     */
    const [viewingId, setViewingId] = useState<string | null>(view ?? null);
    const [viewParam, setViewParam] = useState(view);
    if (viewParam !== view) {
        setViewParam(view);
        setViewingId(view ?? null);
    }
    const setViewing = (next: { readonly item: ReviewItem } | null) => {
        if (next === null && viewingId === null) return;
        setViewingId(next === null ? null : next.item.id);
        router.setParams({ view: next === null ? undefined : next.item.id } as never);
    };

    const queue = useMemo(
        () =>
            sources.data === undefined
                ? null
                : buildReviewQueue({
                      ingredients: sources.data.ingredients,
                      quarantinedRecipes: sources.data.quarantinedRecipes,
                      staleRecipes: sources.data.staleRecipes,
                      products: sources.data.products,
                      meals: sources.data.meals,
                      plans: sources.data.plans,
                      priceLists: sources.data.priceLists,
                  }),
        [sources.data],
    );

    const sections = useMemo(
        () => (queue === null ? [] : narrow(queue, search, scope, from, to, locale)),
        [queue, search, scope, from, to, locale],
    );
    /** One list for the one table, memoised so the table's page survives an unrelated render. */
    const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
    const controls = useReviewColumns({
        items,
        onView: (item) => {
            setViewing({ item });
        },
        onOpen: (item) => {
            open(item);
        },
        testID: 'kitchen-review-table',
    });

    /**
     * Derived from `isError`, not from `toFailure` alone: an unclassifiable rejection would otherwise
     * fall through to the all-clear, and a review queue that celebrates because its own request blew
     * up is the one failure this screen must not have.
     */
    const failure = sources.isError
        ? (toFailure(sources.error) ?? apiFailure('server', { retryable: true }))
        : null;

    /*
     * Into the family's editor, carrying the way back to where the reader pressed Edit — so the
     * editor's Cancel, its trail and a finished fix return there. From the record's page that is
     * the record; from the table it is the table, never a record page the reader did not open.
     */
    const open = (item: ReviewItem) => {
        router.push(
            withReturnTo(
                item.href,
                viewingId === item.id
                    ? withQuery('/kitchen/review', { view: item.id })
                    : '/kitchen/review',
            ) as never,
        );
    };

    // From the whole queue, not the filtered list: a record opened by address stays open whatever
    // the search says.
    const viewingItem =
        viewingId === null || queue === null
            ? null
            : (queue.sections
                  .flatMap((section) => section.items)
                  .find((item) => item.id === viewingId) ?? null);

    /** The queue the search and window leave, the scope aside — what the figures count. */
    const searched =
        queue === null
            ? null
            : narrow(queue, search, 'all', from, to, locale).flatMap((section) => section.items);
    const pickScope = (next: ReviewScope) => {
        setScope(next);
        setViewing(null);
    };
    const pickWindow = (next: PeriodWindow) => {
        setFrom(next.from);
        setTo(next.to);
        setViewing(null);
    };
    const filtered = search.trim() !== '' || scope !== 'all' || from !== '' || to !== '';
    const clearFilters = () => {
        setSearch('');
        pickWindow({ from: '', to: '' });
        pickScope('all');
    };
    const scopeToken = t('kitchen:lens.token', {
        label: t('kitchen:review.scopeLabel'),
        value: t(SCOPE_LABELS[scope]),
    });

    if (viewingItem !== null) {
        return (
            <ReviewWindow
                item={viewingItem}
                onBack={() => {
                    setViewing(null);
                }}
                onOpen={open}
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-review-screen">
            {/*
             * Drawn while the queue loads, its figures held: a bar that waited for the data would
             * push the list down a row the moment it landed. An empty queue has nothing to search.
             */}
            {(queue !== null && queue.total === 0) || failure !== null ? null : (
                <LensBar
                    testID="kitchen-review-toolbar"
                    label={t('kitchen:lens.label')}
                    figures={lensFigures(searched, scope, t, pickScope)}
                    {...(searched === null ? {} : lensMix(searched, scope, t))}
                    search={search}
                    onSearchChange={(next) => {
                        setSearch(next);
                        setViewing(null);
                    }}
                    searchLabel={t('kitchen:review.searchLabel')}
                    searchPlaceholder={t('kitchen:review.searchPlaceholder')}
                    tokens={
                        scope === 'all'
                            ? []
                            : [
                                  {
                                      key: 'scope',
                                      label: scopeToken,
                                      removeLabel: t('kitchen:toolbar.removeFilter', {
                                          filter: scopeToken,
                                      }),
                                      onRemove: () => {
                                          pickScope('all');
                                      },
                                  },
                              ]
                    }
                    result={
                        queue === null
                            ? null
                            : t('kitchen:lens.result', { shown: items.length, total: queue.total })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(filtered ? { onClear: clearFilters } : {})}
                    scope={
                        <>
                            <PeriodScope
                                testID="kitchen-review-filter-period"
                                today={today}
                                value={{ from, to }}
                                allowAll
                                onChange={pickWindow}
                            />
                            <View className="z-auto flex-row items-center gap-tight">
                                <DatePickerButton
                                    testID="kitchen-review-filter-from"
                                    label={t('kitchen:review.filterFrom')}
                                    value={from}
                                    max={to === '' ? undefined : to}
                                    placeholder={t('kitchen:ops.exceptions.fromPlaceholder')}
                                    onChange={(next) => {
                                        pickWindow({ from: next, to });
                                    }}
                                    onClear={() => {
                                        pickWindow({ from: '', to });
                                    }}
                                />
                                <Text variant="caption" tone="secondary" aria-hidden>
                                    {t('kitchen:ops.requirements.windowTo')}
                                </Text>
                                <DatePickerButton
                                    testID="kitchen-review-filter-to"
                                    label={t('kitchen:review.filterTo')}
                                    value={to}
                                    min={from === '' ? undefined : from}
                                    placeholder={t('kitchen:ops.exceptions.toPlaceholder')}
                                    onChange={(next) => {
                                        pickWindow({ from, to: next });
                                    }}
                                    onClear={() => {
                                        pickWindow({ from, to: '' });
                                    }}
                                />
                            </View>
                        </>
                    }
                    trailing={(compact) => <ColumnPicker {...controls.picker} compact={compact} />}
                />
            )}

            {sources.isPending ? (
                <View testID="kitchen-review-loading" className="flex-col">
                    <TableSkeleton partTestID="kitchen-review" rows={6} />
                    <Text variant="caption" tone="secondary" className="pt-2.5">
                        {t('kitchen:review.loadingCaption')}
                    </Text>
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-review-error"
                    failure={failure}
                    title={t('kitchen:review.errorTitle')}
                    onRetry={() => {
                        void sources.refetch();
                    }}
                    retrying={sources.isFetching}
                />
            ) : queue === null || queue.total === 0 ? (
                <EmptyState
                    testID="kitchen-review-clear"
                    title={t('kitchen:review.clearTitle')}
                    body={t('kitchen:review.clearBody')}
                />
            ) : (
                <Stack space="md">
                    {sections.length === 0 ? (
                        /*
                         * The queue has records and the search or scope hid all of them. Not the
                         * all-clear: "nothing is waiting" would be false, and it is the one sentence
                         * this screen must never say by accident.
                         */
                        <EmptyState
                            testID="kitchen-review-filtered-empty"
                            title={t('kitchen:review.filteredEmptyTitle')}
                            body={t('kitchen:review.filteredEmptyBody')}
                            actions={
                                <Button
                                    testID="kitchen-review-clear-filters"
                                    variant="secondary"
                                    size="sm"
                                    label={t('kitchen:toolbar.clearFilters')}
                                    onPress={clearFilters}
                                />
                            }
                        />
                    ) : (
                        <ReviewTable
                            testID="kitchen-review-table"
                            items={items}
                            controls={controls}
                            onView={(item) => {
                                setViewing({ item });
                            }}
                        />
                    )}
                </Stack>
            )}
        </Cascade>
    );
}

function ReviewWindow({
    item,
    onBack,
    onOpen,
}: {
    readonly item: ReviewItem;
    readonly onBack: () => void;
    readonly onOpen: (item: ReviewItem) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const blocked = isBlocked(item);

    return (
        <RecordViewPage
            testID="kitchen-review-window"
            onBack={onBack}
            title={displayName(item.name, locale).value}
            kind={t(reviewFamilyKey(item.familyKey))}
            status={
                blocked
                    ? { label: t('kitchen:review.scopeBlocked'), tone: 'danger' }
                    : { label: t('kitchen:review.scopeUnblocked'), tone: 'warning' }
            }
            note={t('kitchen:review.window.note')}
            fields={[
                {
                    key: 'family',
                    label: t('kitchen:review.window.fieldFamily'),
                    value: t(reviewFamilyKey(item.familyKey)),
                },
                {
                    key: 'status',
                    label: t('kitchen:review.window.fieldStatus'),
                    value: t(statusKey(item.status)),
                },
                {
                    key: 'updated',
                    label: t('kitchen:review.columnUpdated'),
                    value:
                        item.updatedByName === null
                            ? t('kitchen:review.updatedBySeed', {
                                  when: formatter.formatRelativeTime(item.updatedAt),
                              })
                            : t('kitchen:review.updatedBy', {
                                  when: formatter.formatRelativeTime(item.updatedAt),
                                  name: item.updatedByName,
                              }),
                },
                {
                    key: 'publication',
                    label: t('kitchen:review.window.fieldPublication'),
                    value: blocked
                        ? t('kitchen:review.window.publicationBlocked')
                        : t('kitchen:review.window.publicationUnblocked'),
                },
            ]}
            chipsLabel={t('kitchen:review.columnWhy')}
            chipsCaption={t('kitchen:review.window.chipsCaption')}
            chips={item.reasons.map((reason) => ({
                key: reason.code,
                label: t(reviewReasonKey(reason.code), { count: reason.count ?? 1 }),
            }))}
            primaryAction={{
                label: t('kitchen:review.open'),
                icon: null,
                onPress: () => {
                    onOpen(item);
                },
            }}
        />
    );
}

/**
 * The sections the search, scope and window leave, each keeping only its matching rows. The window
 * reads the day the record last changed on the reader's own calendar, as the pickers do.
 */
function narrow(
    queue: ReviewQueue,
    search: string,
    scope: ReviewScope,
    from: string,
    to: string,
    locale: string,
): readonly ReviewSection[] {
    const needle = search.trim().toLocaleLowerCase(locale);
    return queue.sections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => {
                if (scope === 'blocked' && !isBlocked(item)) return false;
                if (scope === 'unblocked' && isBlocked(item)) return false;
                if (from !== '' || to !== '') {
                    const changed = todayIso(new Date(item.updatedAt));
                    if (from !== '' && changed < from) return false;
                    if (to !== '' && changed > to) return false;
                }
                if (needle.length === 0) return true;
                // Both languages, whichever the reader is in: a bilingual kitchen searches by the
                // name it remembers, not by the one the interface happens to display.
                return [item.name.en, item.name.ar].some((name) =>
                    name.toLocaleLowerCase(locale).includes(needle),
                );
            }),
        }))
        .filter((section) => section.items.length > 0);
}

const SCOPE_LABELS: Readonly<Record<ReviewScope, string>> = {
    all: 'kitchen:review.scopeAll',
    blocked: 'kitchen:review.scopeBlocked',
    unblocked: 'kitchen:review.scopeUnblocked',
};

/**
 * The Lens bar's figures: All, then Blocked and To finish, which partition it — each one also
 * narrows the queue to what it counts. `searched` is null while the sources are in flight.
 */
function lensFigures(
    searched: readonly ReviewItem[] | null,
    scope: ReviewScope,
    t: TFunction,
    setScope: (scope: ReviewScope) => void,
): readonly LensFigure[] {
    const blocked = searched === null ? null : searched.filter(isBlocked).length;
    return [
        {
            key: 'all',
            label: t('kitchen:lens.allReview'),
            value: searched === null ? null : searched.length,
            active: scope === 'all',
            onPress: () => {
                setScope('all');
            },
            accessibilityLabel: t('kitchen:lens.allAction'),
        },
        {
            key: 'blocked',
            label: t('kitchen:review.scopeBlocked'),
            value: blocked,
            tone: 'danger',
            alarm: true,
            separated: true,
            active: scope === 'blocked',
            onPress: () => {
                setScope('blocked');
            },
            accessibilityLabel: t('kitchen:lens.showOnlyStatus', {
                status: t('kitchen:review.scopeBlocked'),
            }),
        },
        {
            key: 'unblocked',
            label: t('kitchen:review.scopeUnblocked'),
            value: searched === null || blocked === null ? null : searched.length - blocked,
            tone: 'warning',
            active: scope === 'unblocked',
            onPress: () => {
                setScope('unblocked');
            },
            accessibilityLabel: t('kitchen:lens.showOnlyStatus', {
                status: t('kitchen:review.scopeUnblocked'),
            }),
        },
    ];
}

/** How the searched queue divides between blocked and to finish, and the same in words. */
function lensMix(
    searched: readonly ReviewItem[],
    scope: ReviewScope,
    t: TFunction,
): { readonly mix: readonly LensMixPart[]; readonly mixLabel: string } {
    const blocked = searched.filter(isBlocked).length;
    const unblocked = searched.length - blocked;
    return {
        mix: [
            { key: 'blocked', value: blocked, tone: 'danger', dimmed: scope === 'unblocked' },
            { key: 'unblocked', value: unblocked, tone: 'warning', dimmed: scope === 'blocked' },
        ],
        mixLabel: t('kitchen:lens.reviewMix', { blocked, unblocked }),
    };
}
