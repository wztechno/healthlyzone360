import type { AccountChecklistItem, ConsentState } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    useAccountOverviewQuery,
    useConsentsQuery,
    useSetConsentMutation,
    toFailure,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';

/**
 * `/customer/account` — the setup checklist, and the switches a person can flip afterwards.
 *
 * ## The client does not decide what is outstanding
 *
 * Every fact on this screen is the server's: the order of the steps, whether each one is complete,
 * whether it is `required` **in this environment**, and — separately from all of that —
 * `canActivate`. The screen recomputes none of them.
 *
 * That is not fastidiousness. Phone verification is configurable and switched off in production
 * until a real SMS provider exists (gate A-011), so a client carrying a hard-coded "phone, then
 * address, then consents" rule would show a step the server does not want and tell somebody who is
 * already activatable that they are not. `canActivate` is likewise read, never derived from the
 * items: an evaluator that lives in two places is an evaluator that will disagree with itself.
 *
 * The one thing the screen does compute is presentation — an incomplete-but-optional step is drawn
 * as an invitation and an incomplete-and-required one as a blocker — and that is a rendering
 * decision over the server's two booleans, not a second opinion about them.
 *
 * ## Marketing lives here rather than on the consents screen
 *
 * The consents screen is a compliance surface: full text, versions, a blocking age confirmation.
 * Marketing preferences are a *setting* — the thing a person comes looking for when an email
 * annoyed them — and burying them under three paragraphs of terms is how an unsubscribe becomes
 * hard to find. Both surfaces write the same `setConsent`, so there is one record either way.
 */

/** Where each checklist step is completed. Presentation, so it lives with the presentation. */
const STEP_ROUTES: Readonly<Record<string, string>> = {
    verify_email: '/verify-email',
    verify_phone: '/customer/account/phone',
    add_address: '/customer/account/addresses',
    dietary_profile: '/customer/account/allergies',
    consents: '/customer/account/consents',
};

/** Optional consents whose key names a marketing channel. The rest belong to the consents screen. */
function isMarketingConsent(consent: ConsentState): boolean {
    return !consent.definition.required && consent.definition.key.startsWith('marketing_');
}

function ChecklistRow({ item }: { readonly item: AccountChecklistItem }) {
    const { t } = useTranslation();
    const router = useRouter();
    const route = STEP_ROUTES[item.step];
    const testID = `account-step-${item.step}`;

    return (
        <Card testID={testID} padding="md">
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between">
                    <Text variant="bodyStrong">
                        {t(`account:checklist.steps.${item.step}.title`)}
                    </Text>
                    <Inline space="xs" align="center">
                        {/*
                         * Two badges, not one compound state. "Done" and "needed to activate" are
                         * independent facts, and a person reading a completed-but-optional row
                         * should still learn that it was optional — otherwise the checklist teaches
                         * them that everything on it was mandatory.
                         */}
                        <Badge
                            testID={`${testID}-state`}
                            tone={item.complete ? 'success' : 'neutral'}
                            label={
                                item.complete
                                    ? t('account:checklist.done')
                                    : t('account:checklist.todo')
                            }
                        />
                        <Badge
                            testID={`${testID}-requirement`}
                            tone={item.required ? 'warning' : 'neutral'}
                            label={
                                item.required
                                    ? t('account:checklist.required')
                                    : t('account:checklist.optional')
                            }
                        />
                    </Inline>
                </Inline>

                <Text tone="secondary">{t(`account:checklist.steps.${item.step}.body`)}</Text>

                {item.blockedReason === null ? null : (
                    <Callout
                        testID={`${testID}-blocked`}
                        tone="warning"
                        role="status"
                        title={t('account:checklist.blocked', { reason: item.blockedReason })}
                    />
                )}

                {route === undefined ? null : (
                    <Inline space="sm">
                        <Button
                            testID={`${testID}-open`}
                            size="sm"
                            variant={item.complete ? 'secondary' : 'primary'}
                            // A completed step is still reachable: "change my address" is the same
                            // screen as "add my first address", and hiding it would strand somebody.
                            label={
                                item.complete
                                    ? t('account:checklist.review')
                                    : t('account:checklist.start')
                            }
                            disabled={item.blockedReason !== null}
                            onPress={() => {
                                router.push(route as never);
                            }}
                        />
                    </Inline>
                )}
            </Stack>
        </Card>
    );
}

export function AccountScreen() {
    const { t } = useTranslation();
    const overview = useAccountOverviewQuery();
    const consents = useConsentsQuery();
    const setConsent = useSetConsentMutation();

    const checklist = overview.data?.checklist ?? null;
    const marketing = (consents.data ?? []).filter(isMarketingConsent);
    const setConsentFailure = toFailure(setConsent.error);

    return (
        <Stack space="lg" testID="account-screen">
            <Stack space="xs">
                <Heading level={1} testID="account-title">
                    {t('account:title')}
                </Heading>
                <Text tone="secondary">{t('account:subtitle')}</Text>
                {checklist === null ? null : (
                    <Inline space="xs">
                        <Badge
                            testID="account-lifecycle"
                            tone={checklist.lifecycle === 'active' ? 'success' : 'neutral'}
                            label={t(`account:lifecycle.${checklist.lifecycle}`)}
                        />
                    </Inline>
                )}
            </Stack>

            <QueryStates
                query={overview}
                isEmpty={false}
                emptyTitle={t('account:checklist.title')}
                skeletonCount={3}
                testID="account-checklist"
            >
                <Stack space="md" testID="account-checklist-list">
                    <Callout
                        testID="account-activation"
                        role="status"
                        tone={checklist?.canActivate === true ? 'success' : 'info'}
                        title={
                            checklist?.canActivate === true
                                ? t('account:checklist.canActivate')
                                : t('account:checklist.cannotActivate')
                        }
                        body={
                            checklist?.canActivate === true
                                ? t('account:checklist.subtitle')
                                : t('account:checklist.outstanding', {
                                      count: (checklist?.items ?? []).filter(
                                          (item) => item.required && !item.complete,
                                      ).length,
                                  })
                        }
                    />

                    {/*
                     * Server order, preserved. The evaluator publishes the steps in the sequence it
                     * wants them attempted; re-sorting incomplete-first here would look tidier and
                     * would quietly override a decision the server is entitled to make.
                     */}
                    {(checklist?.items ?? []).map((item) => (
                        <ChecklistRow key={item.step} item={item} />
                    ))}
                </Stack>
            </QueryStates>

            <Card testID="account-marketing" padding="md">
                <Stack space="sm">
                    <Heading level={2} testID="account-marketing-title">
                        {t('account:marketing.title')}
                    </Heading>
                    <Text tone="secondary">{t('account:marketing.subtitle')}</Text>

                    {setConsentFailure === null ? null : (
                        <Callout
                            testID="account-marketing-error"
                            role="alert"
                            tone="danger"
                            title={t('account:marketing.saveFailed')}
                        />
                    )}

                    {consents.isPending ? (
                        <Text tone="secondary" testID="account-marketing-loading">
                            {t('common:state.loading')}
                        </Text>
                    ) : (
                        marketing.map((consent) => (
                            <Checkbox
                                key={consent.definition.key}
                                testID={`account-marketing-${consent.definition.key}`}
                                label={consent.definition.title}
                                description={consent.definition.text}
                                checked={consent.granted}
                                disabled={setConsent.isPending}
                                onChange={(granted) => {
                                    setConsent.mutate({ key: consent.definition.key, granted });
                                }}
                            />
                        ))
                    )}

                    <Text variant="caption" tone="secondary" testID="account-marketing-note">
                        {t('account:marketing.note')}
                    </Text>
                </Stack>
            </Card>
        </Stack>
    );
}
