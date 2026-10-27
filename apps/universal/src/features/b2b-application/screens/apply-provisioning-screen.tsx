import { Badge, Button, Callout, Heading, ListItem, Stack, Text } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useB2BApplicationQuery } from '../../../data/b2b-application-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
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
        <Stack space="lg" testID={TEST_ID}>
            <Heading level={1} testID={`${TEST_ID}-title`}>
                {t('b2bApplication:provisioning.title')}
            </Heading>

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
                ) : (
                    <Stack space="lg">
                        <Text tone="secondary">{t('b2bApplication:provisioning.body')}</Text>

                        <Stack space="xs" testID={`${TEST_ID}-steps`}>
                            {progress.steps.map((step) => (
                                <ListItem
                                    key={step.step}
                                    testID={`${TEST_ID}-step-${step.step}`}
                                    title={t(`b2bApplication:provisioning.steps.${step.step}`)}
                                    {...(step.blockedReason === null
                                        ? {}
                                        : {
                                              description: t(
                                                  'b2bApplication:provisioning.stepBlocked',
                                                  { reason: step.blockedReason },
                                              ),
                                          })}
                                    trailing={
                                        <Badge
                                            testID={`${TEST_ID}-step-${step.step}-state`}
                                            tone={
                                                step.blockedReason !== null
                                                    ? 'danger'
                                                    : step.complete
                                                      ? 'success'
                                                      : 'neutral'
                                            }
                                            label={
                                                step.complete
                                                    ? t('b2bApplication:provisioning.stepDone')
                                                    : t('b2bApplication:provisioning.stepWaiting')
                                            }
                                        />
                                    }
                                />
                            ))}
                        </Stack>

                        {progress.completedAt === null && current.state !== 'provisioned' ? null : (
                            <Stack space="md" testID={`${TEST_ID}-done`}>
                                <Callout
                                    tone="success"
                                    role="status"
                                    title={t('b2bApplication:provisioning.doneTitle')}
                                    body={t('b2bApplication:provisioning.doneBody')}
                                />
                                <Button
                                    testID={`${TEST_ID}-workspace`}
                                    label={t('b2bApplication:provisioning.goToWorkspace')}
                                    onPress={() => {
                                        router.push('/corporate' as never);
                                    }}
                                />
                            </Stack>
                        )}
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
