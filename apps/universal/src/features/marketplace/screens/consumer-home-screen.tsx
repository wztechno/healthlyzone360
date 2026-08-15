import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useMeQuery } from '../../../data/hooks.ts';
import { useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { clearResumeIntent, useResumeIntent } from '../resume-intent.ts';
import { formatMoney } from '../format.ts';
import { QueryStates } from '../query-states.tsx';

/**
 * The signed-in consumer's home.
 *
 * Three things, in the order somebody actually asks for them: who am I, where was I, and what is
 * being delivered.
 *
 * ## What used to be here, and why it is not
 *
 * This page carried a today-at-a-glance card, a nutrition snapshot, an onboarding invitation and a
 * violet band advertising the virtual dietitian. All four read the planner and nutrition contracts,
 * which the API does not implement (`src/features/availability.ts`), so all four rendered the same
 * empty state dressed four different ways — and the band's only action was a link into an area the
 * customer layout now redirects out of. A home page whose top half is placeholder is worse than a
 * short one, so the sections are gone rather than emptied. They come back with their endpoints; the
 * screens behind them were never deleted.
 *
 * Every figure still carries its caveat — the disclaimer stays for the subscription price.
 */
export function ConsumerHomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const me = useMeQuery();
    const subscriptions = useSubscriptionsQuery(true);
    const resume = useResumeIntent();

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
                                {/*
                                 * A real navigation, not a prototype notice: subscriptions are one
                                 * of the contracts the API does implement, and
                                 * `/customer/subscriptions/{id}` is the screen that manages this
                                 * exact record.
                                 */}
                                <Button
                                    testID="consumer-subscription-manage"
                                    variant="secondary"
                                    size="sm"
                                    label={t('marketplace:consumer.subscription.manage')}
                                    onPress={() => {
                                        router.push(
                                            `/customer/subscriptions/${String(activeSubscription.id)}` as never,
                                        );
                                    }}
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
