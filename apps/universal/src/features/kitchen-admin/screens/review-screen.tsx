import { apiFailure } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReviewQueueQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, statusKey, statusTone } from '../format.ts';
import {
    buildReviewQueue,
    isBlockingReason,
    reviewFamilyKey,
    reviewReasonKey,
    reviewRowTestId,
} from '../review-queue.ts';
import type { ReviewItem, ReviewQueue } from '../review-queue.ts';

/**
 * `/kitchen/review` — the publication review queue (K1.8).
 *
 * ## The one screen in this workspace that is not about a family
 *
 * Every other kitchen screen answers "show me the ingredients / the recipes / the price lists". This
 * one answers the question a kitchen manager actually opens the workspace with: **what is stopping
 * anything from going out?** That is a question across six families at once, which is why the queue
 * is a section per family rather than a seventh list — and why a family with nothing to report gets
 * no heading at all. A heading with nothing under it reads as a loading state that never resolved.
 *
 * ## It states what it checked, and it never claims more
 *
 * `KitchenAdminRepository` publishes no readiness verdict — no `getReadiness`, no `blockers`, no
 * `quarantineReason` field on any shape. So the reasons on these rows are derived from what the
 * contract *does* say, in `../review-queue.ts`, and the all-clear state prints the list of things
 * that were examined instead of a bare tick. "Nothing needs review" is only trustworthy if the
 * reader can see what "nothing" was measured against; a green tick over an unstated check is the
 * most expensive true-sounding sentence a management screen can print.
 *
 * Three parts of the workspace are named as *not* checked, for the same reason: delivery zones have
 * no `publishZone` on the contract and so cannot be quarantined, a branch's operating week has no
 * publication state at all, and the allergen classes are platform reference data nobody in a kitchen
 * can change (decision D-041).
 *
 * ## Nothing is written from here
 *
 * There is no "resolve", no "publish anyway" and no bulk action. Every row is a link into the
 * family's own editor, which is where the lock version, the unsaved guard, the conflict dialog and
 * the publish confirmation already live — and where a quarantine banner already renders. A queue
 * that could clear a food-safety quarantine in one click, from a screen holding no lock version and
 * showing none of the record, would be the single most dangerous control in this programme.
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

/**
 * One row: what it is, why it is here, and when it last moved.
 *
 * The reasons are chips rather than a sentence because a record can carry several — a quarantined
 * recipe whose derivation is also stale is two different jobs — and a comma-joined sentence would
 * make the blocking one indistinguishable from the rest. Blocking reasons take the danger tone;
 * everything else is a warning, which is the distinction `../review-queue.ts` documents: "you
 * cannot" and "you have not yet" are different sentences.
 */
function ReviewRow({ item }: { readonly item: ReviewItem }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();

    const testID = reviewRowTestId(item.familyKey, item.id);
    const name = displayName(item.name, locale);

    return (
        <Card testID={testID} padding="md">
            <Stack space="sm">
                <Inline space="sm" align="center" wrap>
                    <Text variant="bodyStrong" testID={`${testID}-name`}>
                        {name.value}
                    </Text>
                    <Badge
                        testID={`${testID}-status`}
                        tone={statusTone(item.status)}
                        label={t(statusKey(item.status))}
                    />
                </Inline>

                <Inline space="xs" wrap testID={`${testID}-reasons`}>
                    {item.reasons.map((reason) => (
                        <Badge
                            key={reason.code}
                            testID={`${testID}-reason-${reason.code}`}
                            tone={isBlockingReason(reason.code) ? 'danger' : 'warning'}
                            icon="warning"
                            label={t(reviewReasonKey(reason.code), {
                                count: reason.count ?? 1,
                            })}
                        />
                    ))}
                </Inline>

                <Text variant="caption" tone="secondary" testID={`${testID}-updated`}>
                    {item.updatedByName === null
                        ? t('kitchen:review.updatedBySeed', {
                              when: formatter.formatRelativeTime(item.updatedAt),
                          })
                        : t('kitchen:review.updatedBy', {
                              when: formatter.formatRelativeTime(item.updatedAt),
                              name: item.updatedByName,
                          })}
                </Text>

                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-open`}
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:review.open')}
                        onPress={() => {
                            router.push(item.href as never);
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}

function ReviewSections({ queue }: { readonly queue: ReviewQueue }) {
    const { t } = useTranslation();

    return (
        <Stack space="lg" testID="kitchen-review-sections">
            {queue.sections.map((section) => (
                <Stack
                    key={section.familyKey}
                    space="sm"
                    testID={`kitchen-review-section-${section.familyKey}`}
                >
                    <Inline space="sm" align="center" wrap>
                        <Heading
                            level={2}
                            testID={`kitchen-review-section-${section.familyKey}-title`}
                        >
                            {t(reviewFamilyKey(section.familyKey))}
                        </Heading>
                        <Badge
                            testID={`kitchen-review-section-${section.familyKey}-count`}
                            tone="neutral"
                            icon="dot"
                            label={t('kitchen:review.sectionCount', {
                                count: section.items.length,
                            })}
                        />
                    </Inline>

                    {section.items.map((item) => (
                        <ReviewRow key={item.id} item={item} />
                    ))}
                </Stack>
            ))}
        </Stack>
    );
}

function ReviewQueueBody() {
    const { t } = useTranslation();
    const router = useRouter();
    const sources = useReviewQueueQuery();

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

    /**
     * The failure, and the reason it is derived from `isError` rather than from `toFailure` alone.
     *
     * `toFailure` answers `null` for anything that is not a recognisable `ApiFailure` — a thrown
     * `TypeError`, a rejected promise carrying a string. On most screens that only costs a generic
     * message. Here it would be a *lie*: falling through to the next branch would render the
     * all-clear state, and a review queue that celebrates because its own request blew up is the one
     * failure mode this screen must not have. So the query's own error flag decides, and an
     * unclassifiable rejection is presented as the server-side problem it is.
     */
    const failure = sources.isError
        ? (toFailure(sources.error) ?? apiFailure('server', { retryable: true }))
        : null;

    return (
        <Stack space="lg" testID="kitchen-review-screen">
            <Button
                testID="kitchen-review-back"
                variant="ghost"
                size="sm"
                label={t('kitchen:common.back')}
                onPress={() => {
                    router.push('/kitchen' as never);
                }}
            />

            <Stack space="xs">
                <Heading level={1} testID="kitchen-review-title">
                    {t('kitchen:review.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-review-subtitle">
                    {t('kitchen:review.subtitle')}
                </Text>
            </Stack>

            {sources.isPending ? (
                <Stack space="sm" testID="kitchen-review-loading">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-review-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-2/3" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
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
                /*
                 * The all-clear, which has to be honest before it is celebratory. It names the six
                 * families that were examined, because a green state whose scope is unstated is
                 * indistinguishable from a query that silently returned nothing.
                 */
                <Stack space="sm">
                    <EmptyState
                        testID="kitchen-review-clear"
                        title={t('kitchen:review.clearTitle')}
                        body={t('kitchen:review.clearBody')}
                    />
                    <Text variant="caption" tone="secondary" testID="kitchen-review-clear-scope">
                        {t('kitchen:review.scope')}
                    </Text>
                </Stack>
            ) : (
                <Stack space="lg">
                    <Callout
                        testID="kitchen-review-summary"
                        role={queue.blocked > 0 ? 'alert' : 'note'}
                        tone={queue.blocked > 0 ? 'warning' : 'info'}
                        title={t('kitchen:review.summaryTitle', { count: queue.total })}
                        body={
                            queue.blocked > 0
                                ? t('kitchen:review.summaryBlocked', { count: queue.blocked })
                                : t('kitchen:review.summaryUnblocked')
                        }
                    />

                    {sources.data?.truncated === true ? (
                        <Callout
                            testID="kitchen-review-truncated"
                            role="note"
                            tone="info"
                            title={t('kitchen:review.truncatedTitle')}
                            body={t('kitchen:review.truncatedBody')}
                        />
                    ) : null}

                    <ReviewSections queue={queue} />

                    <Text variant="caption" tone="secondary" testID="kitchen-review-scope">
                        {t('kitchen:review.scope')}
                    </Text>
                    <Text variant="caption" tone="secondary" testID="kitchen-review-not-checked">
                        {t('kitchen:review.notChecked')}
                    </Text>
                </Stack>
            )}
        </Stack>
    );
}
