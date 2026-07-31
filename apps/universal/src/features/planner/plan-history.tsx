import {
    Button,
    Card,
    Drawer,
    Inline,
    Stack,
    Text,
    useBreakpoint,
} from '@healthy360/design-system';
import type { PlanHistoryEvent } from '@healthy360/api-client/contracts';
import type { MealPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { historyFromPages, usePlanHistoryQuery } from '../../data/planner-hooks.ts';
import { QueryStates } from '../marketplace/query-states.tsx';

/**
 * The plan history drawer.
 *
 * `PlanHistoryEvent.summary` is a human-readable sentence the server composes, and the contract says
 * in as many words that the UI shows it rather than reconstructing one. That is honoured here: the
 * action code decides the icon and the actor label, and the sentence itself is rendered verbatim.
 * A client that rebuilt "Monday dinner locked." from `action`, `entryId` and `date` would drift out
 * of step with the server the first time an action gained a nuance.
 *
 * Paged with a cursor because a plan that has been edited for a month has more events than a drawer
 * can hold, and the "show more" button says when there are no more rather than leaving a reader
 * scrolling into nothing.
 */
export interface PlanHistoryDrawerProps {
    readonly planId: MealPlanId;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly testID?: string | undefined;
}

const ACTOR_KEYS = {
    customer: 'planner:history.actorCustomer',
    dietitian: 'planner:history.actorDietitian',
    system: 'planner:history.actorSystem',
} as const;

export function PlanHistoryDrawer({
    planId,
    open,
    onClose,
    testID = 'planner-history',
}: PlanHistoryDrawerProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();

    const history = usePlanHistoryQuery(planId, open);
    const events: readonly PlanHistoryEvent[] = historyFromPages(history.data?.pages);

    return (
        <Drawer
            testID={testID}
            open={open}
            onClose={onClose}
            placement={atLeast('lg') ? 'end' : 'bottom'}
            title={t('planner:history.title')}
            className={atLeast('lg') ? 'w-[420px] max-w-[95vw]' : undefined}
        >
            <Stack space="md" testID={`${testID}-body`}>
                <Text variant="caption" tone="secondary">
                    {t('planner:history.intro')}
                </Text>

                <QueryStates
                    query={history}
                    isEmpty={events.length === 0}
                    emptyTitle={t('planner:history.emptyTitle')}
                    emptyBody={t('planner:history.emptyBody')}
                    skeletonCount={3}
                    testID={`${testID}-states`}
                >
                    <Stack space="sm" testID={`${testID}-events`}>
                        {events.map((event) => (
                            <Card
                                key={event.id}
                                testID={`${testID}-event-${event.id}`}
                                padding="sm"
                                tone="raised"
                            >
                                <Stack space="none">
                                    <Text variant="bodyStrong">{event.summary}</Text>
                                    <Inline space="xs" wrap>
                                        <Text variant="caption" tone="secondary">
                                            {t(ACTOR_KEYS[event.actor])}
                                        </Text>
                                        <Text variant="caption" tone="secondary">
                                            {formatter.formatDate(event.at, {
                                                dateStyle: 'medium',
                                                timeStyle: 'short',
                                            })}
                                        </Text>
                                        <Text
                                            testID={`${testID}-event-${event.id}-action`}
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t(`planner:history.actions.${event.action}`)}
                                        </Text>
                                    </Inline>
                                </Stack>
                            </Card>
                        ))}

                        <Button
                            testID={`${testID}-more`}
                            variant="secondary"
                            label={
                                history.isFetchingNextPage
                                    ? t('planner:history.loadingMore')
                                    : history.hasNextPage
                                      ? t('planner:history.loadMore')
                                      : t('planner:history.allLoaded')
                            }
                            disabled={!history.hasNextPage || history.isFetchingNextPage}
                            onPress={() => {
                                void history.fetchNextPage();
                            }}
                        />
                    </Stack>
                </QueryStates>
            </Stack>
        </Drawer>
    );
}
