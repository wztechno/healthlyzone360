import type { ConsentState } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    Separator,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { toFailure, useConsentsQuery, useSetConsentMutation } from '../../../data/account-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { SubpageTrail } from '../../../ui/subpage-trail.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    AGE_CONFIRMATION_KEY,
    ageConfirmed,
    consentStatus,
    listableConsents,
} from '../consents.ts';
import { useConsentLabel } from '../consent-labels.ts';

/**
 * `/customer/account/consents` — what a person has agreed to, in the words they agreed to.
 *
 * ## One plain line per consent (BUG-11)
 *
 * The server sends a consent's code and no wording, so each row is the first-person line from
 * `../consent-labels.ts`, its status and its one action — nothing else. What is needed to order and
 * what is optional sit in two cards, split on the definition's own `required` flag. Versions,
 * requirement badges and counts are left off: they are the ledger's facts, not the customer's.
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
 *
 * ## Done is a press, not a save
 *
 * Each consent is stored the moment it is pressed, so there is nothing to submit — but a person
 * sent here by the checkout or the plan setup (`?returnTo=`) needs a way back once everything
 * required is agreed. The button at the foot says where it goes ("Back to checkout"), and is
 * enabled once the age and every required consent are granted. Opened from the account it reads
 * Done and returns there.
 */

const TEST_ID = 'consents-screen';

export interface ConsentsScreenProps {
    /** The route's `?returnTo=` — the page to go back to once everything required is agreed. */
    readonly returnTo?: string | undefined;
}

const STATUS_TONE = {
    granted: 'success',
    reconsent: 'warning',
    withdrawn: 'neutral',
    never: 'neutral',
} as const;

export function ConsentsScreen({ returnTo }: ConsentsScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const label = useConsentLabel();
    const back = useReturnTo(returnTo, '/customer/account?section=notifications');

    const consents = useConsentsQuery();
    const setConsent = useSetConsentMutation();

    const all = consents.data ?? [];
    const age = all.find((consent) => consent.definition.key === AGE_CONFIRMATION_KEY);
    const confirmed = ageConfirmed(all);
    const listed = listableConsents(all);

    const failure = toFailure(setConsent.error);
    const busy = setConsent.isPending;
    const requiredAgreed =
        confirmed && all.every((consent) => !consent.definition.required || consent.granted);
    // The one being saved spins; the rest only wait, so a press never looks like every row moved.
    const savingKey = busy ? setConsent.variables?.key : undefined;

    const change = (consent: ConsentState, granted: boolean) => {
        setConsent.mutate({ key: consent.definition.key, granted });
    };

    function consentRow(consent: ConsentState, index: number) {
        const status = consentStatus(consent);
        const testID = `consent-${consent.definition.key}`;
        // Optional consents are never gated on the age confirmation: withdrawing marketing email
        // has nothing to do with how old somebody is, and blocking it would be coercive.
        const gated = consent.definition.required && !confirmed;
        const saving = savingKey === consent.definition.key;
        const waiting = busy && !saving;

        return (
            <Stack key={consent.definition.key} space="sm" testID={testID}>
                {index === 0 ? null : <Separator />}
                <Inline space="sm" align="center" justify="between" wrap>
                    <Text testID={`${testID}-title`} className="min-w-0 flex-1">
                        {label(consent.definition.key)}
                    </Text>
                    <Inline space="sm" align="center">
                        <Badge
                            testID={`${testID}-status`}
                            // `label`, not the pill: it sits in a row beside the button, and the
                            // pill's own top alignment would hang it above the button's centre.
                            variant="label"
                            tone={STATUS_TONE[status]}
                            label={t(`account:consents.status.${status}`)}
                        />
                        {consent.granted ? (
                            <Button
                                testID={`${testID}-withdraw`}
                                size="sm"
                                variant="secondary"
                                label={t('account:consents.withdraw')}
                                loading={saving}
                                disabled={waiting}
                                onPress={() => {
                                    change(consent, false);
                                }}
                            />
                        ) : (
                            <Button
                                testID={`${testID}-grant`}
                                size="sm"
                                label={t('account:consents.grant')}
                                loading={saving}
                                disabled={gated || waiting}
                                onPress={() => {
                                    change(consent, true);
                                }}
                            />
                        )}
                    </Inline>
                </Inline>

                {status === 'reconsent' ? (
                    <Callout
                        testID={`${testID}-reconsent`}
                        role="status"
                        tone="warning"
                        title={t('account:consents.reconsentTitle')}
                    />
                ) : null}

                {consent.grantedAt === null ? null : (
                    <Text variant="caption" tone="secondary" testID={`${testID}-granted-at`}>
                        {t('account:consents.grantedOn', {
                            date: formatter.formatDate(consent.grantedAt, { dateStyle: 'long' }),
                        })}
                    </Text>
                )}
                {consent.withdrawnAt === null ? null : (
                    <Text variant="caption" tone="secondary" testID={`${testID}-withdrawn-at`}>
                        {t('account:consents.withdrawnOn', {
                            date: formatter.formatDate(consent.withdrawnAt, { dateStyle: 'long' }),
                        })}
                    </Text>
                )}
            </Stack>
        );
    }

    /** One card per group, so what is needed to order and what is optional never mix. */
    function group(id: string, title: string, rows: readonly ConsentState[]) {
        if (rows.length === 0) return null;
        return (
            <Card testID={`${TEST_ID}-${id}`} padding="md">
                <Stack space="md">
                    <Heading level={2}>{title}</Heading>
                    <Stack space="sm">{rows.map(consentRow)}</Stack>
                </Stack>
            </Card>
        );
    }

    return (
        <Stack space="lg" testID={TEST_ID}>
            <SubpageTrail
                testID={`${TEST_ID}-trail`}
                back={back}
                current={t('account:consents.title')}
            />
            <Heading level={1} testID={`${TEST_ID}-title`}>
                {t('account:consents.title')}
            </Heading>

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
                                label={label(age?.definition.key ?? AGE_CONFIRMATION_KEY)}
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
                                />
                            )}
                        </Stack>
                    </Card>

                    {group(
                        'required',
                        t('account:consents.neededTitle'),
                        listed.filter((consent) => consent.definition.required),
                    )}
                    {group(
                        'optional',
                        t('account:consents.offersTitle'),
                        listed.filter((consent) => !consent.definition.required),
                    )}

                    <Inline space="sm">
                        <Button
                            testID={`${TEST_ID}-done`}
                            label={
                                back.returnTo === null
                                    ? t('common:action.done')
                                    : t(`common:returnTo.${back.destination}`)
                            }
                            disabled={busy || (back.returnTo !== null && !requiredAgreed)}
                            onPress={() => {
                                back.finish();
                            }}
                        />
                    </Inline>
                </Stack>
            </QueryStates>
        </Stack>
    );
}
