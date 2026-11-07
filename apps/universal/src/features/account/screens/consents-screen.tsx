import type { ConsentState } from '@healthy360/api-client/contracts';
import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { toFailure, useConsentsQuery, useSetConsentMutation } from '../../../data/account-hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { AuthCheck, AuthError } from '../../../ui/auth-form.tsx';
import { ShopSwitch } from '../../../ui/shop-switch.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    ExtraButton,
    ExtraCard,
    ExtraChip,
    ExtraPage,
    ExtraSmallButton,
} from '../account-extra.tsx';
import {
    AGE_CONFIRMATION_KEY,
    ageConfirmed,
    consentStatus,
    listableConsents,
} from '../consents.ts';
import { useConsentLabel } from '../consent-labels.ts';

/**
 * `/customer/account/consents` — what a person has agreed to, in the words they agreed to, drawn as
 * the accepted Permissions board: the amber age gate, "Needed to order" with each row's chip and
 * Agree, "Offers and updates" on the shop's switch, and the line saying what is left.
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
    granted: 'ok',
    reconsent: 'amber',
    withdrawn: 'mute',
    never: 'mute',
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

    /** The row's glyph, from what the consent is about. */
    const glyph = (key: string): IconName => {
        if (key.includes('privacy')) return 'shield';
        if (key.includes('health')) return 'heartPulse';
        if (key.includes('allergen')) return 'warning';
        if (key.includes('whatsapp') || key.includes('sms')) return 'smartphone';
        if (key.includes('email') || key.includes('marketing')) return 'send';
        return 'fileText';
    };

    function consentRow(consent: ConsentState, index: number) {
        const status = consentStatus(consent);
        const testID = `consent-${consent.definition.key}`;
        const required = consent.definition.required;
        // Optional consents are never gated on the age confirmation: withdrawing marketing email
        // has nothing to do with how old somebody is, and blocking it would be coercive.
        const gated = required && !confirmed;
        const saving = savingKey === consent.definition.key;
        const waiting = busy && !saving;
        const note =
            status === 'reconsent'
                ? t('account:consents.reconsentTitle')
                : required && !consent.granted
                  ? t('account:consents.neededNote')
                  : null;

        return (
            <View
                key={consent.definition.key}
                testID={testID}
                className={cx(
                    'flex-row flex-wrap items-center gap-3 py-3',
                    index === 0 ? '' : 'border-t border-stroke-subtle',
                    gated ? 'opacity-45' : '',
                )}
            >
                <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-surface-base">
                    <Icon
                        name={glyph(consent.definition.key)}
                        size="md"
                        className="text-content-on-brand-subtle"
                    />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        testID={`${testID}-title`}
                        className="text-base font-semibold text-content-primary text-start"
                    >
                        {label(consent.definition.key)}
                    </RNText>
                    {note === null ? null : (
                        <RNText
                            testID={status === 'reconsent' ? `${testID}-reconsent` : undefined}
                            className="mt-0.5 text-xs font-medium text-content-secondary text-start"
                        >
                            {note}
                        </RNText>
                    )}
                    {consent.grantedAt === null ? null : (
                        <RNText
                            testID={`${testID}-granted-at`}
                            className="mt-0.5 text-xs font-medium text-content-secondary text-start"
                        >
                            {t('account:consents.grantedOn', {
                                date: formatter.formatDate(consent.grantedAt, {
                                    dateStyle: 'long',
                                }),
                            })}
                        </RNText>
                    )}
                    {consent.withdrawnAt === null ? null : (
                        <RNText
                            testID={`${testID}-withdrawn-at`}
                            className="mt-0.5 text-xs font-medium text-content-secondary text-start"
                        >
                            {t('account:consents.withdrawnOn', {
                                date: formatter.formatDate(consent.withdrawnAt, {
                                    dateStyle: 'long',
                                }),
                            })}
                        </RNText>
                    )}
                </View>
                <ExtraChip
                    testID={`${testID}-status`}
                    tone={STATUS_TONE[status]}
                    label={t(`account:consents.status.${status}`)}
                />
                {required ? (
                    consent.granted ? (
                        <ExtraSmallButton
                            testID={`${testID}-withdraw`}
                            tone="secondary"
                            label={t('account:consents.withdraw')}
                            busy={saving}
                            disabled={waiting}
                            onPress={() => {
                                change(consent, false);
                            }}
                        />
                    ) : (
                        <ExtraSmallButton
                            testID={`${testID}-grant`}
                            label={t('account:consents.grant')}
                            busy={saving}
                            disabled={gated || waiting}
                            onPress={() => {
                                change(consent, true);
                            }}
                        />
                    )
                ) : (
                    <ShopSwitch
                        testID={`${testID}-toggle`}
                        label={label(consent.definition.key)}
                        checked={consent.granted}
                        disabled={busy}
                        onChange={(granted) => {
                            change(consent, granted);
                        }}
                    />
                )}
            </View>
        );
    }

    /** One card per group, so what is needed to order and what is optional never mix. */
    function group(id: string, title: string, rows: readonly ConsentState[]) {
        if (rows.length === 0) return null;
        return (
            <ExtraCard testID={`${TEST_ID}-${id}`} title={title}>
                <View className="mt-1">{rows.map(consentRow)}</View>
            </ExtraCard>
        );
    }

    const required = listed.filter((consent) => consent.definition.required);
    const left = (confirmed ? 0 : 1) + required.filter((consent) => !consent.granted).length;

    return (
        <ExtraPage
            testID={TEST_ID}
            backTestID={`${TEST_ID}-trail-up`}
            backLabel={
                back.returnTo === null
                    ? t('account:title')
                    : t(`common:destination.${back.destination}`)
            }
            onBack={back.up}
            icon="shield"
            title={t('account:consents.title')}
            titleTestID={`${TEST_ID}-title`}
        >
            {failure === null ? null : (
                <View className="mt-[18px]">
                    <AuthError testID={`${TEST_ID}-error`} message={failure.message} />
                </View>
            )}

            <QueryStates
                skeleton="rows"
                query={consents}
                isEmpty={all.length === 0}
                emptyTitle={t('account:consents.empty')}
                emptyBody={t('account:consents.emptyBody')}
                skeletonCount={3}
                testID={`${TEST_ID}-list`}
            >
                {/* The age confirmation: a gate, drawn as one — amber until it is ticked. */}
                <View
                    testID={`${TEST_ID}-age`}
                    className={cx(
                        'mt-[18px] flex-row flex-wrap items-center gap-3.5 rounded-[20px] border-[1.5px] px-[18px] py-2',
                        confirmed
                            ? 'border-surface-brand bg-surface-brand-subtle'
                            : 'border-warning-border bg-warning-subtle',
                    )}
                >
                    <View className="min-w-0 flex-1">
                        <AuthCheck
                            testID={`${TEST_ID}-age-checkbox`}
                            label={label(age?.definition.key ?? AGE_CONFIRMATION_KEY)}
                            checked={confirmed}
                            onChange={(granted) => {
                                if (age !== undefined && !busy) change(age, granted);
                            }}
                        />
                        {confirmed ? null : (
                            <RNText
                                testID={`${TEST_ID}-age-blocking`}
                                role="alert"
                                className="-mt-1 mb-1.5 ms-[34px] text-xs font-semibold text-warning-on-subtle text-start"
                            >
                                {t('account:consents.ageGateTitle')}
                            </RNText>
                        )}
                    </View>
                    {confirmed ? (
                        <ExtraChip tone="ok" label={t('account:consents.status.granted')} />
                    ) : null}
                </View>

                {group('required', t('account:consents.neededTitle'), required)}
                {group(
                    'optional',
                    t('account:consents.offersTitle'),
                    listed.filter((consent) => !consent.definition.required),
                )}

                <View className="mt-[18px] flex-row flex-wrap items-center justify-between gap-3 rounded-[20px] bg-surface-base px-[18px] py-4">
                    {requiredAgreed ? (
                        <View className="flex-row items-center gap-2">
                            <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                            <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                {t('account:consents.allAgreed')}
                            </RNText>
                        </View>
                    ) : (
                        <RNText className="text-sm font-semibold text-content-secondary">
                            {t('account:consents.leftToAgree', { count: Math.max(1, left) })}
                        </RNText>
                    )}
                    <ExtraButton
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
                </View>
            </QueryStates>
        </ExtraPage>
    );
}
