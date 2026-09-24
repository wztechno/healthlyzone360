import { apiFailure } from '@healthy360/api-client/contracts';
import { Button, EmptyState, ErrorState, Skeleton, Stack, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReviewQueueQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, statusKey } from '../format.ts';
import { ReviewTable } from '../review/review-table.tsx';
import { buildReviewQueue, isBlocked, reviewFamilyKey, reviewReasonKey } from '../review-queue.ts';
import type { ReviewItem, ReviewQueue, ReviewSection } from '../review-queue.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';

/**
 * `/kitchen/review` — the publication review queue (K1.8), as `Workbench.dc.html` draws it.
 *
 * ```
 * Needs review  [ READ ONLY ]
 * ┌ SHOWN ┐ ┌ BLOCKED ┐ ┌ TO FINISH ┐
 * [ ⌕ Designation or name ]  [ All | Blocked | To finish ]
 * ID        DESIGNATION         WHY IT IS HERE          LAST CHANGED          ◉ ✎
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
 * ## The cards count the filtered queue
 *
 * Shown, Blocked and To finish are counted over the rows the search and scope leave on screen, so
 * narrowing the queue moves the cards with it (§3z rule 1). Shown's unit states the whole queue — "of
 * 6" — which is the one figure a filter should not move.
 */
export function ReviewScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-review"
        >
            <ReviewQueueBody />
        </Gate>
    );
}

type ReviewScope = 'all' | 'blocked' | 'unblocked';

interface Viewing {
    readonly item: ReviewItem;
}

function ReviewQueueBody() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const sources = useReviewQueueQuery();

    const [search, setSearch] = useState('');
    const [scope, setScope] = useState<ReviewScope>('all');
    const [viewing, setViewing] = useState<Viewing | null>(null);

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
        () => (queue === null ? [] : narrow(queue, search, scope, locale)),
        [queue, search, scope, locale],
    );
    /** One list for the one table, memoised so the table's page survives an unrelated render. */
    const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);

    /**
     * Derived from `isError`, not from `toFailure` alone: an unclassifiable rejection would otherwise
     * fall through to the all-clear, and a review queue that celebrates because its own request blew
     * up is the one failure this screen must not have.
     */
    const failure = sources.isError
        ? (toFailure(sources.error) ?? apiFailure('server', { retryable: true }))
        : null;

    const open = (item: ReviewItem) => {
        setViewing(null);
        router.push(item.href as never);
    };

    if (viewing !== null) {
        return (
            <ReviewWindow
                item={viewing.item}
                onBack={() => {
                    setViewing(null);
                }}
                onOpen={open}
            />
        );
    }

    return (
        <Stack space="md" testID="kitchen-review-screen">
            {queue === null || queue.total === 0 || failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-review-summary"
                    cards={statCards(queue, sections, t, (next) => {
                        setScope(next);
                        setViewing(null);
                    })}
                />
            )}

            {queue === null || queue.total === 0 || failure !== null ? null : (
                <CatalogueToolbar<ReviewScope>
                    testID="kitchen-review-toolbar"
                    search={search}
                    onSearchChange={(next) => {
                        setSearch(next);
                        setViewing(null);
                    }}
                    searchLabel={t('kitchen:review.searchLabel')}
                    searchPlaceholder={t('kitchen:review.searchPlaceholder')}
                    statusLabel={t('kitchen:review.scopeLabel')}
                    statusSegments={[
                        { value: 'all', label: t('kitchen:review.scopeAll') },
                        { value: 'blocked', label: t('kitchen:review.scopeBlocked') },
                        { value: 'unblocked', label: t('kitchen:review.scopeUnblocked') },
                    ]}
                    status={scope}
                    onStatusChange={(next) => {
                        setScope(next);
                        setViewing(null);
                    }}
                />
            )}

            {sources.isPending ? (
                <View testID="kitchen-review-loading" className="flex-col">
                    {Array.from({ length: 6 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton
                                testID={`kitchen-review-skeleton-${String(index + 1)}`}
                                heightClassName="h-2"
                            />
                        </View>
                    ))}
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
                                    onPress={() => {
                                        setSearch('');
                                        setScope('all');
                                    }}
                                />
                            }
                        />
                    ) : (
                        <ReviewTable
                            testID="kitchen-review-table"
                            items={items}
                            onView={(item) => {
                                setViewing({ item });
                            }}
                            onOpen={open}
                        />
                    )}
                </Stack>
            )}
        </Stack>
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

/** The sections the search and scope leave, each keeping only its matching rows. */
function narrow(
    queue: ReviewQueue,
    search: string,
    scope: ReviewScope,
    locale: string,
): readonly ReviewSection[] {
    const needle = search.trim().toLocaleLowerCase(locale);
    return queue.sections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => {
                if (scope === 'blocked' && !isBlocked(item)) return false;
                if (scope === 'unblocked' && isBlocked(item)) return false;
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

/** The admin's standard figure cards — each one also narrows the queue to what it counts. */
function statCards(
    queue: ReviewQueue,
    sections: readonly ReviewSection[],
    t: TFunction,
    setScope: (scope: ReviewScope) => void,
): readonly CatalogueStatCard[] {
    const shown = sections.reduce((sum, section) => sum + section.items.length, 0);
    const blocked = sections.reduce(
        (sum, section) => sum + section.items.filter(isBlocked).length,
        0,
    );
    return [
        {
            key: 'shown',
            label: t('kitchen:review.statShown'),
            value: String(shown),
            unit: t('kitchen:list.statShownUnit', { total: queue.total }),
            caption: t('kitchen:review.statShownCaption', { count: sections.length }),
            mark: 'list',
            tone: 'brand',
            onPress: () => {
                setScope('all');
            },
            accessibilityLabel: t('kitchen:review.scopeAll'),
        },
        {
            key: 'blocked',
            label: t('kitchen:review.scopeBlocked'),
            value: String(blocked),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:review.statBlockedCaption'),
            mark: 'alert',
            tone: blocked === 0 ? 'default' : 'danger',
            onPress: () => {
                setScope('blocked');
            },
            accessibilityLabel: t('kitchen:review.scopeBlocked'),
        },
        {
            key: 'unblocked',
            label: t('kitchen:review.scopeUnblocked'),
            value: String(shown - blocked),
            unit: t('kitchen:list.statRecords'),
            caption: t('kitchen:review.statToFinishCaption'),
            mark: 'lockOpen',
            tone: shown - blocked === 0 ? 'default' : 'warning',
            onPress: () => {
                setScope('unblocked');
            },
            accessibilityLabel: t('kitchen:review.scopeUnblocked'),
        },
    ];
}
