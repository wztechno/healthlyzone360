import {
    Accordion,
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
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { toFailure, useConsentsQuery, useSetConsentMutation } from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    AGE_CONFIRMATION_KEY,
    ageConfirmed,
    consentStatus,
    listableConsents,
    outstandingRequired,
} from '../consents.ts';
import type { ConsentState } from '../repositories-shim.ts';

/**
 * `/customer/account/consents` — what a person has agreed to, in the words they agreed to.
 *
 * ## The full text is on the page, not behind a link
 *
 * `ConsentDefinition.text` is authored per locale on the server rather than machine-translated at
 * render time, because a consent somebody agreed to has to be the text they were shown (OQ-033).
 * The screen honours that by showing it: an {@link Accordion} panel per consent, collapsed so the
 * list stays readable and expandable so the words are one tap away. A link to a separate page would
 * mean the agreement and the text it refers to are two different requests, either of which can be
 * the one that fails.
 *
 * ## The age confirmation blocks, and it blocks visibly
 *
 * It is drawn above the list as a single checkbox and, until it is ticked, every other agree
 * control on the page is disabled with the reason stated. Two things this is *not*: it is not a
 * pre-ticked box, and it is not a footnote. A person under the age this product may serve should
 * find the page refusing to proceed rather than discovering later that agreeing was implied by
 * their scrolling past a sentence.
 *
 * Untangling it from the list also stops it being one row of seven — a legally load-bearing gate
 * drawn as if it were a preference about email frequency.
 *
 * ## Four states, not two
 *
 * See `../consents.ts`. "Not agreed" covers never-agreed, withdrawn-by-you and agreed-to-an-older-
 * version, and telling somebody the wrong one is worse than saying nothing.
 */

const TEST_ID = 'consents-screen';

const STATUS_TONE = {
    granted: 'success',
    reconsent: 'warning',
    withdrawn: 'neutral',
    never: 'neutral',
} as const;

export function ConsentsScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const consents = useConsentsQuery();
    const setConsent = useSetConsentMutation();

    const all = consents.data ?? [];
    const age = all.find((consent) => consent.definition.key === AGE_CONFIRMATION_KEY);
    const confirmed = ageConfirmed(all);
    const outstanding = outstandingRequired(all);
    const listed = listableConsents(all);

    const failure = toFailure(setConsent.error);
    const busy = setConsent.isPending;

    const change = (consent: ConsentState, granted: boolean) => {
        setConsent.mutate({ key: consent.definition.key, granted });
    };

    function consentPanel(consent: ConsentState) {
        const status = consentStatus(consent);
        const testID = `consent-${consent.definition.key}`;
        // Optional consents are never gated on the age confirmation: withdrawing marketing email
        // has nothing to do with how old somebody is, and blocking it would be coercive.
        const gated = consent.definition.required && !confirmed;

        return {
            key: consent.definition.key,
            title: consent.definition.title,
            children: (
                <Stack space="sm" testID={testID}>
                    <Inline space="xs" wrap align="center">
                        <Badge
                            testID={`${testID}-status`}
                            tone={STATUS_TONE[status]}
                            label={t(`account:consents.status.${status}`)}
                        />
                        <Badge
                            testID={`${testID}-requirement`}
                            tone={consent.definition.required ? 'warning' : 'neutral'}
                            label={
                                consent.definition.required
                                    ? t('account:consents.required')
                                    : t('account:consents.optional')
                            }
                        />
                        <Badge
                            testID={`${testID}-version`}
                            tone="neutral"
                            icon={null}
                            label={t('account:consents.version', {
                                version: consent.definition.version,
                            })}
                        />
                    </Inline>

                    <Text testID={`${testID}-text`}>{consent.definition.text}</Text>

                    {status === 'reconsent' ? (
                        <Callout
                            testID={`${testID}-reconsent`}
                            role="status"
                            tone="warning"
                            title={t('account:consents.reconsentTitle')}
                            body={t('account:consents.reconsentBody')}
                        />
                    ) : null}

                    {consent.grantedAt === null ? null : (
                        <Text variant="caption" tone="secondary" testID={`${testID}-granted-at`}>
                            {t('account:consents.grantedOn', {
                                date: formatter.formatDate(consent.grantedAt, {
                                    dateStyle: 'long',
                                }),
                            })}
                        </Text>
                    )}
                    {consent.withdrawnAt === null ? null : (
                        <Text variant="caption" tone="secondary" testID={`${testID}-withdrawn-at`}>
                            {t('account:consents.withdrawnOn', {
                                date: formatter.formatDate(consent.withdrawnAt, {
                                    dateStyle: 'long',
                                }),
                            })}
                        </Text>
                    )}

                    {consent.definition.required ? (
                        <Text variant="caption" tone="secondary">
                            {t('account:consents.requiredNote')}
                        </Text>
                    ) : null}

                    <Inline space="sm" wrap>
                        {consent.granted ? (
                            <Button
                                testID={`${testID}-withdraw`}
                                size="sm"
                                variant="secondary"
                                label={t('account:consents.withdraw')}
                                loading={busy}
                                onPress={() => {
                                    change(consent, false);
                                }}
                            />
                        ) : (
                            <Button
                                testID={`${testID}-grant`}
                                size="sm"
                                label={t('account:consents.grant')}
                                loading={busy}
                                disabled={gated}
                                onPress={() => {
                                    change(consent, true);
                                }}
                            />
                        )}
                    </Inline>

                    {gated ? (
                        <Text variant="caption" tone="secondary" testID={`${testID}-gated`}>
                            {t('account:consents.ageGate')}
                        </Text>
                    ) : null}
                </Stack>
            ),
        };
    }

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:consents.title')}
                </Heading>
                <Text tone="secondary">{t('account:consents.subtitle')}</Text>
            </Stack>

            {failure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={failure.message}
                />
            )}

            <QueryStates
                query={consents}
                isEmpty={all.length === 0}
                emptyTitle={t('account:consents.empty')}
                emptyBody={t('account:consents.emptyBody')}
                skeletonCount={3}
                testID={`${TEST_ID}-list`}
            >
                <Stack space="md">
                    <Card testID={`${TEST_ID}-age`} padding="md" tone="sunken">
                        <Stack space="sm">
                            <Heading level={2}>{t('account:consents.ageTitle')}</Heading>
                            <Checkbox
                                testID={`${TEST_ID}-age-checkbox`}
                                label={age?.definition.title ?? t('account:consents.ageTitle')}
                                description={age?.definition.text ?? ''}
                                required
                                checked={confirmed}
                                disabled={busy || age === undefined}
                                onChange={(granted) => {
                                    if (age !== undefined) change(age, granted);
                                }}
                            />
                            {confirmed ? null : (
                                <Callout
                                    testID={`${TEST_ID}-age-blocking`}
                                    role="alert"
                                    tone="warning"
                                    title={t('account:consents.ageGateTitle')}
                                    body={t('account:consents.ageGate')}
                                />
                            )}
                        </Stack>
                    </Card>

                    <Callout
                        testID={`${TEST_ID}-outstanding`}
                        role="status"
                        tone={outstanding.length === 0 ? 'success' : 'info'}
                        title={
                            outstanding.length === 0
                                ? t('account:consents.allRequiredDone')
                                : t('account:consents.outstanding', { count: outstanding.length })
                        }
                    />

                    {/*
                     * Outstanding required consents start expanded.
                     *
                     * `defaultExpandedKeys` is uncontrolled, which is exactly right here: it is a
                     * starting position, not a rule. `QueryStates` renders its children only once
                     * the data has arrived, so the first mount already knows which consents are
                     * outstanding — and a person who then collapses a panel is not fought with by
                     * the next refetch.
                     */}
                    <Accordion
                        testID={`${TEST_ID}-accordion`}
                        multiple
                        defaultExpandedKeys={outstanding.map((consent) => consent.definition.key)}
                        items={listed.map(consentPanel)}
                    />
                </Stack>
            </QueryStates>
        </Stack>
    );
}
