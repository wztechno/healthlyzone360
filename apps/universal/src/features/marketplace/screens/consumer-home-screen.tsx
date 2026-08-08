import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    ListItem,
    MeterBar,
    Stack,
    Text,
} from '@healthy360/design-system';
import { readNutritionLevels } from '@healthy360/nutrition';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { toFailure, useMeQuery } from '../../../data/hooks.ts';
import {
    useConsumerDayQuery,
    useCurrentTargetsQuery,
    useSubscriptionsQuery,
} from '../../../data/marketplace-hooks.ts';
import { PrototypeButton } from '../../../prototype/prototype-notice.tsx';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { clearResumeIntent, useResumeIntent } from '../resume-intent.ts';
import { formatMoney } from '../format.ts';
import { QueryStates } from '../query-states.tsx';
import { AiBand } from '../../../ui/ai-surface.tsx';

/** The nutrients the snapshot shows, in the order a person reads them. */
const SNAPSHOT_NUTRIENTS: readonly string[] = ['energy', 'protein', 'carbohydrate', 'fat', 'fibre'];

/**
 * The signed-in consumer's home.
 *
 * Four questions, in the order somebody actually asks them: what am I eating next, how does that
 * sit against my target, is anything being delivered, and where was I.
 *
 * ## The onboarding branch is a state, not an error
 *
 * `getCurrentTargets()` answering `null` is the whole `consumer-onboarding` world: no target, an
 * empty planner, nothing to review. That is a designed screen — a single clear invitation — rather
 * than a home page full of empty cards, because a person on their first day should be told what to
 * do next and not shown five things that are all zero.
 *
 * ## Every figure carries its caveat
 *
 * The snapshot meters read synthetic data through a prototype calculator. The disclaimer is on the
 * screen for the same reason it is on every other screen that shows a number.
 */
export function ConsumerHomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const me = useMeQuery();
    const targets = useCurrentTargetsQuery(true);
    const day = useConsumerDayQuery(true);
    const subscriptions = useSubscriptionsQuery(true);
    const resume = useResumeIntent();

    const hasTarget = targets.data != null;
    // Nutrition/planner are deferred on the API: a `prototype.not_implemented` answer must not
    // open the onboarding CTA (that CTA still names an unimplemented endpoint).
    const targetsUnavailable =
        toFailure(targets.error)?.code === 'prototype.not_implemented';
    const onboardingPending =
        !targetsUnavailable && targets.data === null && !targets.isPending;

    const summary = day.data?.day.summary;
    const dayTargets = day.data?.day.targets ?? [];
    const readings =
        summary === undefined || dayTargets.length === 0
            ? []
            : readNutritionLevels(summary.planned, dayTargets).filter((reading) =>
                  SNAPSHOT_NUTRIENTS.includes(reading.nutrientId),
              );

    const activeSubscription = (subscriptions.data?.items ?? []).find(
        (subscription) => subscription.state !== 'cancelled',
    );

    return (
        <Stack space="lg" testID="consumer-home-screen">
            <Stack space="xs">
                <Heading level={1} testID="consumer-greeting">
                    {me.data === undefined
                        ? t('marketplace:consumer.greetingAnonymous')
                        : t('marketplace:consumer.greeting', {
                              name: me.data.profile.givenName ?? me.data.profile.displayName,
                          })}
                </Heading>
                <Text tone="secondary">{t('marketplace:consumer.subtitle')}</Text>
            </Stack>

            {resume === null ? null : (
                <Callout
                    testID="consumer-resume"
                    role="status"
                    tone="info"
                    title={t('marketplace:consumer.resume.title')}
                    body={t('marketplace:consumer.resume.body', {
                        destination: resume.name ?? t(resume.labelKey),
                    })}
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="consumer-resume-continue"
                                size="sm"
                                label={t('marketplace:consumer.resume.continue')}
                                onPress={() => {
                                    const { href } = resume;
                                    clearResumeIntent();
                                    router.push(href as never);
                                }}
                            />
                            <Button
                                testID="consumer-resume-dismiss"
                                size="sm"
                                variant="ghost"
                                label={t('marketplace:consumer.resume.dismiss')}
                                onPress={clearResumeIntent}
                            />
                        </Inline>
                    }
                />
            )}

            {onboardingPending ? (
                <Card padding="lg" tone="brand" testID="consumer-onboarding-cta">
                    <Stack space="sm">
                        <Heading level={2}>{t('marketplace:consumer.onboarding.title')}</Heading>
                        <Text tone="secondary">{t('marketplace:consumer.onboarding.body')}</Text>
                        <PrototypeButton
                            label={t('marketplace:consumer.onboarding.start')}
                            contract="POST /api/v1/nutrition/calculate-targets"
                            variant="primary"
                        />
                    </Stack>
                </Card>
            ) : null}

            {/*
             * Rule 5's band. The virtual dietitian is a destination in the sidebar and nowhere
             * else on this page, which for the product's most distinctive feature is a poor
             * showing — and it is precisely the thing violet is reserved to mark, so the band has
             * somewhere honest to be. It says "AI dietitian" in words as well as in colour,
             * because origin is never carried by colour alone.
             */}
            <AiBand
                testID="consumer-ai-band"
                title={t('virtualDietitian:entry.title')}
                body={t('virtualDietitian:entry.startBody')}
                actionLabel={t('virtualDietitian:entry.start')}
                onAction={() => {
                    router.push('/customer/virtual-dietitian' as never);
                }}
            />

            <Stack space="sm" testID="consumer-today">
                <Heading level={2}>{t('marketplace:consumer.today.title')}</Heading>
                <QueryStates
                    query={day}
                    isEmpty={day.data === null || (day.data?.day.entries.length ?? 0) === 0}
                    emptyTitle={t('marketplace:consumer.today.emptyTitle')}
                    emptyBody={t('marketplace:consumer.today.emptyBody')}
                    treatFailuresAsEmpty={['prototype.not_implemented']}
                    emptyActions={
                        <Button
                            testID="consumer-today-browse"
                            variant="secondary"
                            label={t('marketplace:landing.browseKitchens')}
                            onPress={() => {
                                router.push('/kitchens');
                            }}
                        />
                    }
                    skeletonCount={1}
                    testID="today-card"
                >
                    {day.data == null ? null : (
                        <Card padding="md" tone="raised" testID="today-card-content">
                            <Stack space="sm">
                                <Inline space="xs" align="center" wrap>
                                    <Text variant="label">
                                        {day.data.isToday
                                            ? t('marketplace:consumer.today.forToday')
                                            : t('marketplace:consumer.today.forDate', {
                                                  date: formatter.formatDate(
                                                      `${day.data.day.date}T12:00:00.000Z`,
                                                      {
                                                          weekday: 'long',
                                                          day: 'numeric',
                                                          month: 'long',
                                                      },
                                                  ),
                                              })}
                                    </Text>
                                    {summary?.estimatedCost == null ? null : (
                                        <Badge
                                            testID="today-card-cost"
                                            tone="neutral"
                                            label={formatMoney(formatter, summary.estimatedCost)}
                                        />
                                    )}
                                </Inline>

                                <Stack space="xs" testID="today-card-entries">
                                    {day.data.day.entries.map((entry) => (
                                        <ListItem
                                            key={entry.id}
                                            testID={`today-entry-${String(entry.id)}`}
                                            title={entry.label}
                                            description={t(
                                                `marketplace:mealTypes.${entry.mealType}`,
                                            )}
                                            trailing={
                                                entry.locked ? (
                                                    <Badge
                                                        tone="info"
                                                        label={t(
                                                            'marketplace:consumer.today.locked',
                                                        )}
                                                    />
                                                ) : undefined
                                            }
                                        />
                                    ))}
                                </Stack>

                                <PrototypeButton
                                    label={t('marketplace:consumer.today.openPlanner')}
                                    contract="GET /api/v1/meal-plans/{plan}"
                                    showBadge={false}
                                    size="sm"
                                />
                            </Stack>
                        </Card>
                    )}
                </QueryStates>
            </Stack>

            <Stack space="sm" testID="consumer-nutrition">
                <Heading level={2}>{t('marketplace:consumer.nutrition.title')}</Heading>
                <QueryStates
                    query={targets}
                    isEmpty={!hasTarget || readings.length === 0}
                    emptyTitle={t('marketplace:consumer.nutrition.emptyTitle')}
                    emptyBody={t('marketplace:consumer.nutrition.emptyBody')}
                    treatFailuresAsEmpty={['prototype.not_implemented']}
                    skeletonCount={1}
                    testID="nutrition-snapshot"
                >
                    <Card padding="md" tone="raised" testID="nutrition-snapshot-content">
                        <Stack space="sm">
                            {readings.map((reading) => (
                                <MeterBar
                                    key={reading.nutrientId}
                                    testID={`nutrition-meter-${reading.nutrientId}`}
                                    label={t(`marketplace:nutrients.${reading.nutrientId}`)}
                                    value={Math.round(reading.value)}
                                    target={Math.round(reading.target)}
                                    level={reading.level}
                                    levelLabel={t(`marketplace:levels.${reading.level}`)}
                                />
                            ))}
                            <PrototypeButton
                                label={t('marketplace:consumer.nutrition.whyThisTarget')}
                                contract="GET /api/v1/nutrition/targets/current"
                                showBadge={false}
                                size="sm"
                            />
                        </Stack>
                    </Card>
                </QueryStates>
            </Stack>

            <Stack space="sm" testID="consumer-subscription">
                <Heading level={2}>{t('marketplace:consumer.subscription.title')}</Heading>
                <QueryStates
                    query={subscriptions}
                    isEmpty={activeSubscription === undefined}
                    emptyTitle={t('marketplace:consumer.subscription.emptyTitle')}
                    emptyBody={t('marketplace:consumer.subscription.emptyBody')}
                    emptyActions={
                        <Button
                            testID="consumer-subscription-browse"
                            variant="secondary"
                            label={t('marketplace:landing.browseKitchens')}
                            onPress={() => {
                                router.push('/kitchens');
                            }}
                        />
                    }
                    skeletonCount={1}
                    testID="subscription-card"
                >
                    {activeSubscription === undefined ? null : (
                        <Card padding="md" tone="raised" testID="subscription-card-content">
                            <Stack space="sm">
                                <Inline space="xs" align="center" wrap>
                                    <Text variant="bodyStrong">{activeSubscription.planName}</Text>
                                    <Badge
                                        testID="subscription-state"
                                        tone={
                                            activeSubscription.state === 'active'
                                                ? 'success'
                                                : 'warning'
                                        }
                                        label={t(
                                            `marketplace:subscriptionStates.${activeSubscription.state}`,
                                        )}
                                    />
                                </Inline>
                                <Text tone="secondary">
                                    {activeSubscription.nextDeliveryDate === null
                                        ? t('marketplace:consumer.subscription.noNextDelivery')
                                        : t('marketplace:consumer.subscription.nextDelivery', {
                                              date: formatter.formatDate(
                                                  `${activeSubscription.nextDeliveryDate}T12:00:00.000Z`,
                                                  { day: 'numeric', month: 'long' },
                                              ),
                                          })}
                                </Text>
                                <Text tone="secondary" variant="caption">
                                    {t('marketplace:consumer.subscription.weeklyPrice', {
                                        price: formatMoney(
                                            formatter,
                                            activeSubscription.weeklyPrice,
                                        ),
                                    })}
                                </Text>
                                <PrototypeButton
                                    label={t('marketplace:consumer.subscription.manage')}
                                    contract="GET /api/v1/subscriptions/{subscription}"
                                    showBadge={false}
                                    size="sm"
                                />
                            </Stack>
                        </Card>
                    )}
                </QueryStates>
            </Stack>

            <MedicalDisclaimer />
        </Stack>
    );
}
