import {
    Badge,
    Button,
    Card,
    Checkbox,
    FilterChip,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';
import { REVIEW_SUBJECTS } from '@healthy360/api-client/contracts';
import type {
    ReviewQueueFilter,
    ReviewQueueItem,
    ReviewQueueState,
    ReviewSubject,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useReviewQueueQuery } from '../../../data/professional-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    PRIORITY_ICON,
    PRIORITY_TONE,
    QUEUE_STATE_TONE,
    priorityKey,
    queueStateKey,
    reasonKey,
    subjectKey,
} from '../format.ts';

/**
 * `/dietitian` — everything waiting for a professional decision.
 *
 * ## This screen is where the product's safety claims are paid for
 *
 * Every `requiresProfessionalReview` flag the target engine raises, every Virtual Dietitian session
 * that hit a restriction conflict, and every week somebody asked a human to check arrives here
 * (`contracts/professional.ts` argues the same point from the other side). If the queue does not
 * exist, those flags are decoration — so the reasons that put each item here are shown on the row
 * itself rather than one level down, and a code nobody has written copy for renders as the code
 * instead of vanishing.
 *
 * ## The disclaimer is on the list, not only on the detail
 *
 * A queue row shows a client's name beside a triage priority, which is health information about a
 * named person. `MedicalDisclaimer` is mandatory wherever that appears (plan §5), and it is asserted
 * by test on every screen in this feature.
 */

const STATE_FILTERS = ['all', 'awaiting', 'in_review', 'decided'] as const;
type StateFilter = (typeof STATE_FILTERS)[number];

const FILTER_STATES: Readonly<Record<StateFilter, readonly ReviewQueueState[]>> = {
    all: [],
    awaiting: ['awaiting_review'],
    in_review: ['in_review'],
    decided: ['approved', 'declined', 'changes_requested'],
};

export function ReviewQueueScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [stateFilter, setStateFilter] = useState<StateFilter>('all');
    const [subjects, setSubjects] = useState<readonly ReviewSubject[]>([]);
    const [mineOnly, setMineOnly] = useState(false);

    const states = FILTER_STATES[stateFilter];
    const filter: ReviewQueueFilter = {
        ...(states.length === 0 ? {} : { states }),
        ...(subjects.length === 0 ? {} : { subjects }),
        ...(mineOnly ? { assignedToMe: true } : {}),
    };

    const queue = useReviewQueueQuery(filter);
    const items: readonly ReviewQueueItem[] = queue.data?.items ?? [];

    const clearFilters = () => {
        setStateFilter('all');
        setSubjects([]);
        setMineOnly(false);
    };

    return (
        <Stack space="lg" testID="review-queue-screen">
            <Stack space="xs">
                <Heading level={1} testID="review-queue-title">
                    {t('professional:queue.title')}
                </Heading>
                <Text tone="secondary">{t('professional:queue.body')}</Text>
            </Stack>

            <MedicalDisclaimer context={t('professional:queue.disclaimerContext')} />

            <SegmentedControl
                testID="review-queue-state"
                label={t('professional:queue.stateLabel')}
                block
                value={stateFilter}
                onChange={(next) => {
                    setStateFilter(next as StateFilter);
                }}
                items={STATE_FILTERS.map((key) => ({
                    value: key,
                    label: t(`professional:queue.stateFilters.${key}`),
                    testID: `review-queue-state-${key}`,
                }))}
            />

            <Stack space="xs" testID="review-queue-subjects">
                <Text variant="label">{t('professional:queue.subjectLabel')}</Text>
                <Inline space="xs" wrap>
                    {REVIEW_SUBJECTS.map((subject) => (
                        <FilterChip
                            key={subject}
                            testID={`review-queue-subject-${subject}`}
                            label={t(subjectKey(subject))}
                            selected={subjects.includes(subject)}
                            onChange={(selected) => {
                                setSubjects((current) =>
                                    selected
                                        ? [...current, subject]
                                        : current.filter((value) => value !== subject),
                                );
                            }}
                        />
                    ))}
                </Inline>
            </Stack>

            <Checkbox
                testID="review-queue-mine"
                label={t('professional:queue.mineLabel')}
                description={t('professional:queue.mineHint')}
                checked={mineOnly}
                onChange={setMineOnly}
            />

            <QueryStates
                query={queue}
                isEmpty={items.length === 0}
                emptyTitle={t('professional:queue.emptyTitle')}
                emptyBody={t('professional:queue.emptyBody')}
                emptyActions={
                    <Button
                        testID="review-queue-clear"
                        variant="secondary"
                        label={t('professional:queue.clearFilters')}
                        onPress={clearFilters}
                    />
                }
                skeletonCount={3}
                testID="review-queue"
            >
                <Stack space="sm" testID="review-queue-list">
                    {items.map((item) => (
                        <Card key={item.id} testID={`review-row-${item.id}`} padding="md">
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text
                                        variant="bodyStrong"
                                        testID={`review-row-${item.id}-client`}
                                    >
                                        {item.clientDisplayName}
                                    </Text>
                                    <Badge
                                        testID={`review-row-${item.id}-priority`}
                                        tone={PRIORITY_TONE[item.priority]}
                                        icon={PRIORITY_ICON[item.priority]}
                                        label={t(priorityKey(item.priority))}
                                    />
                                </Inline>

                                <Inline space="xs" wrap>
                                    <Badge
                                        testID={`review-row-${item.id}-subject`}
                                        tone="info"
                                        icon="info"
                                        label={t(subjectKey(item.subject))}
                                    />
                                    <Badge
                                        testID={`review-row-${item.id}-state`}
                                        tone={QUEUE_STATE_TONE[item.state]}
                                        icon="dot"
                                        label={t(queueStateKey(item.state))}
                                    />
                                    {item.assignedTo === null ? (
                                        <Badge
                                            testID={`review-row-${item.id}-unassigned`}
                                            tone="neutral"
                                            icon="dot"
                                            label={t('professional:queue.unassigned')}
                                        />
                                    ) : null}
                                </Inline>

                                <Text
                                    testID={`review-row-${item.id}-reasons`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {item.reasons.length === 0
                                        ? t('professional:queue.noReasons')
                                        : item.reasons
                                              .map((code) =>
                                                  t(reasonKey(code), { defaultValue: code }),
                                              )
                                              .join(t('professional:common.listSeparator'))}
                                </Text>

                                <Text
                                    testID={`review-row-${item.id}-requested`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('professional:queue.requested', {
                                        date: formatter.formatDate(item.requestedAt, {
                                            dateStyle: 'medium',
                                        }),
                                    })}
                                </Text>

                                <Inline space="sm" wrap>
                                    <Button
                                        testID={`review-row-${item.id}-open`}
                                        size="sm"
                                        label={t('professional:queue.open')}
                                        onPress={() => {
                                            router.push(`/dietitian/reviews/${item.id}` as never);
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            </QueryStates>
        </Stack>
    );
}
