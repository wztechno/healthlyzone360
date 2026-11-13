import { Icon, cx } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useB2BApplicationQuery } from '../../../data/b2b-application-hooks.ts';
import { ExtraButton, ExtraCard, ExtraChip, ExtraPage } from '../../account/account-extra.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AuthTick } from '../../../ui/auth-form.tsx';
import { isProvisioning } from '../sections.ts';

/**
 * `/apply/provisioning` — the account being built.
 *
 * ## Named steps, not a percentage
 *
 * "Creating your organisation" is something a person can understand and, when it stalls, something
 * support can be told. A progress bar over an idempotent server transaction would be a number
 * invented on the device, and the moment it mattered — a step that is stuck — is exactly the moment
 * a bar at 80 % would be least honest. `ProvisioningProgress.steps` carries a `blockedReason` for
 * precisely that case, and this screen shows it rather than continuing to look busy.
 *
 * ## Leaving is safe, and the page says so
 *
 * Nothing here is driven by the page staying open. The copy says that, because the alternative is a
 * person sitting on a spinner for two minutes in case closing the tab breaks something. While it is
 * open, the read polls every thirty seconds until the application stops waiting on the platform.
 */

const TEST_ID = 'b2b-apply-provisioning';
const POLL_MS = 30_000;

export function ApplyProvisioningScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const application = useB2BApplicationQuery(true, POLL_MS);
    const current = application.data ?? null;
    const progress = current?.provisioning ?? null;

    return (
        <ExtraPage
            testID={TEST_ID}
            backTestID={`${TEST_ID}-back`}
            backLabel={t('b2bApplication:status.title')}
            onBack={() => {
                router.push('/apply/status' as never);
            }}
            icon="settings"
            title={t('b2bApplication:provisioning.title')}
            titleTestID={`${TEST_ID}-title`}
            lede={t('b2bApplication:provisioning.body')}
        >
            <QueryStates
                query={application}
                isEmpty={false}
                emptyTitle={t('b2bApplication:provisioning.title')}
                testID={TEST_ID}
            >
                {current === null ? (
                    <Redirect href={'/apply' as never} />
                ) : !isProvisioning(current) || progress === null ? (
                    // Nothing being provisioned. The status panel says what *is* happening.
                    <Redirect href={'/apply/status' as never} />
                ) : progress.completedAt === null && current.state !== 'provisioned' ? (
                    <ExtraCard testID={`${TEST_ID}-steps`}>
                        {progress.steps.map((step, index) => {
                            // The first step not done is the one being worked on now.
                            const working =
                                !step.complete &&
                                progress.steps.findIndex((other) => !other.complete) === index;
                            const blocked = step.blockedReason !== null;
                            return (
                                <View
                                    key={step.step}
                                    testID={`${TEST_ID}-step-${step.step}`}
                                    className="flex-row items-center gap-3 border-t border-stroke-subtle py-3 first:border-t-0"
                                >
                                    <View
                                        className={cx(
                                            'h-10 w-10 items-center justify-center rounded-[13px]',
                                            step.complete
                                                ? 'bg-surface-brand'
                                                : blocked
                                                  ? 'bg-danger-subtle'
                                                  : working
                                                    ? 'bg-surface-brand-subtle'
                                                    : 'bg-surface-base',
                                        )}
                                    >
                                        <Icon
                                            name={
                                                step.complete
                                                    ? 'check'
                                                    : blocked
                                                      ? 'alert'
                                                      : working
                                                        ? 'settings'
                                                        : 'clock'
                                            }
                                            size="md"
                                            className={
                                                step.complete
                                                    ? 'text-content-on-brand'
                                                    : blocked
                                                      ? 'text-danger-on-subtle'
                                                      : working
                                                        ? 'text-content-on-brand-subtle'
                                                        : 'text-content-secondary'
                                            }
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1">
                                        <RNText className="text-base font-semibold text-content-primary text-start">
                                            {t(`b2bApplication:provisioning.steps.${step.step}`)}
                                        </RNText>
                                        {step.blockedReason === null ? null : (
                                            <RNText className="mt-0.5 text-sm text-danger-on-subtle text-start">
                                                {t('b2bApplication:provisioning.stepBlocked', {
                                                    reason: step.blockedReason,
                                                })}
                                            </RNText>
                                        )}
                                    </View>
                                    <ExtraChip
                                        testID={`${TEST_ID}-step-${step.step}-state`}
                                        tone={
                                            blocked
                                                ? 'bad'
                                                : step.complete
                                                  ? 'ok'
                                                  : working
                                                    ? 'amber'
                                                    : 'mute'
                                        }
                                        label={
                                            step.complete
                                                ? t('b2bApplication:provisioning.stepDone')
                                                : t('b2bApplication:provisioning.stepWaiting')
                                        }
                                    />
                                </View>
                            );
                        })}
                    </ExtraCard>
                ) : (
                    // The board's finish: the tick, what is now true, and the way into the account.
                    <ExtraCard testID={`${TEST_ID}-done`}>
                        <View testID={`${TEST_ID}-steps`} className="flex-col items-center py-4">
                            <AuthTick />
                            <RNText
                                accessibilityRole="header"
                                aria-level={2}
                                className="mt-6 font-display text-2xl font-bold text-content-primary text-center"
                            >
                                {t('b2bApplication:provisioning.doneTitle')}
                            </RNText>
                            <RNText className="mt-1.5 max-w-[460px] text-base font-medium leading-6 text-content-secondary text-center">
                                {t('b2bApplication:provisioning.doneBody')}
                            </RNText>
                            <View className="mt-5">
                                <ExtraButton
                                    testID={`${TEST_ID}-workspace`}
                                    label={t('b2bApplication:provisioning.goToWorkspace')}
                                    icon="arrowForward"
                                    onPress={() => {
                                        router.push('/corporate' as never);
                                    }}
                                />
                            </View>
                        </View>
                    </ExtraCard>
                )}
            </QueryStates>
        </ExtraPage>
    );
}
