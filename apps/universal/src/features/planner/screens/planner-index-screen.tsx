import { Button, EmptyState, Inline, Stack } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentPlanQuery } from '../../../data/planner-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { mondayOf } from '../format.ts';

/**
 * `/customer/planner` — the entry point, which is a redirect nine times out of ten.
 *
 * The planner is addressed by week (`/customer/planner/week/{monday}`) so that a week is linkable,
 * reloadable and reachable with the back button. That leaves `/customer/planner` with exactly one
 * job: work out *which* week, and go there.
 *
 * ## The plan is resolved through `getCurrentPlan`, and never through a Virtual Dietitian session
 *
 * Wave 2 had no plan-listing operation and resolved a plan identifier through the approved VD
 * session's `draftPlanId`. That draft only exists once `generateDraft` has actually run, so a cold
 * read of a fixture session's draft plan fails outright. `GET /api/v1/meal-plans/current` was added
 * at the Wave 2 gate precisely so this screen does not have to do that, and `null` from it is a real
 * answer rather than an error: it means the person has not been through onboarding or the Virtual
 * Dietitian yet, and the two routes out of that are the two things they need.
 */
export function PlannerIndexScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { me } = useSession();
    const signedIn = me !== null;

    const currentPlan = useCurrentPlanQuery(signedIn);
    const plan = currentPlan.data ?? null;

    useEffect(() => {
        if (plan === null) return;
        router.replace(`/customer/planner/week/${mondayOf(plan.weekStart)}` as never);
    }, [plan, router]);

    return (
        <Stack space="lg" testID="planner-index-screen">
            <QueryStates
                query={currentPlan}
                isEmpty={plan === null}
                emptyTitle={t('planner:index.noPlanTitle')}
                emptyBody={t('planner:index.noPlanBody')}
                emptyActions={
                    <Inline space="sm" wrap>
                        <Button
                            testID="planner-index-virtual-dietitian"
                            label={t('planner:index.startVirtualDietitian')}
                            onPress={() => {
                                router.push('/customer/virtual-dietitian');
                            }}
                        />
                        <Button
                            testID="planner-index-onboarding"
                            variant="secondary"
                            label={t('planner:index.startOnboarding')}
                            onPress={() => {
                                router.push('/customer/onboarding');
                            }}
                        />
                    </Inline>
                }
                skeletonCount={1}
                testID="planner-index"
            >
                {/* Reached for the single frame between the plan arriving and the redirect. */}
                <EmptyState
                    testID="planner-index-resolving"
                    title={t('planner:index.resolvingTitle')}
                    body={t('planner:index.resolvingBody')}
                    actions={
                        plan === null ? undefined : (
                            <Button
                                testID="planner-index-open-week"
                                label={t('planner:index.openWeek')}
                                onPress={() => {
                                    router.replace(
                                        `/customer/planner/week/${mondayOf(plan.weekStart)}` as never,
                                    );
                                }}
                            />
                        )
                    }
                />
            </QueryStates>
        </Stack>
    );
}
