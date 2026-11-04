import type { ApiFailure } from '@healthy360/api-client';
import type { B2BAgreement } from '@healthy360/api-client/contracts';
import { Checkbox, Icon, TextInputField } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { ExtraButton, ExtraCard, ExtraNote } from '../account/account-extra.tsx';

import { OtpChallengePanel } from '../verification/otp-challenge-panel.tsx';
import type { OtpChallengeView } from '../verification/otp-challenge-panel.tsx';

/**
 * Reading an agreement and accepting it.
 *
 * ## What this screen is careful about
 *
 * **It never calls this a signature without saying what kind.** The honesty block is not a footnote
 * and not a tooltip: it sits directly above the control that records the acceptance, in the same
 * visual weight as the terms, and it says in plain words that this records acceptance rather than
 * being a qualified electronic signature. The plan calls that "OTP click-wrap signature honesty"
 * and INT-007 is the register entry for the real thing. A person who later disputes this should be
 * able to say what they were told, and they were told this.
 *
 * **Three separate claims, three separate controls.** The typed name says *who*; the title says
 * *in what capacity*; the checkbox says *I may bind this company*. They are not one control with
 * three implications, because only the third is the one that matters if the company later says the
 * signatory had no authority — and a checkbox somebody had to tick is evidence in a way that a name
 * in a box is not.
 *
 * **The code comes first.** {@link OtpChallengePanel} (purpose `b2b_signatory`) has to succeed
 * before the acceptance control opens at all. A signature anybody borrowing a logged-in screen could
 * produce is not evidence of who signed, and the step-up is the only thing standing between the two.
 *
 * **The digest is echoed back.** `documentSha256` goes out with the acceptance so a server can
 * refuse a signature made against a document that changed under the person reading it.
 */

export interface AgreementPanelProps {
    readonly agreement: B2BAgreement;
    /** The live `b2b_signatory` challenge, once one has been issued. */
    readonly challenge?: OtpChallengeView | null | undefined;
    /** Non-null once the code verified — this is what unlocks the acceptance control. */
    readonly verificationToken?: string | null | undefined;
    readonly issuing?: boolean | undefined;
    readonly verifying?: boolean | undefined;
    readonly resending?: boolean | undefined;
    readonly signing?: boolean | undefined;
    readonly failure?: ApiFailure | null | undefined;
    readonly onRequestCode: () => void;
    readonly onVerifyCode: (code: string) => void;
    readonly onResendCode: (channel: string) => void;
    readonly onSign: (request: {
        readonly typedName: string;
        readonly signatoryTitle: string;
        readonly authorityConfirmed: boolean;
    }) => void;
    readonly testID?: string | undefined;
}

export function AgreementPanel({
    agreement,
    challenge = null,
    verificationToken = null,
    issuing = false,
    verifying = false,
    resending = false,
    signing = false,
    failure = null,
    onRequestCode,
    onVerifyCode,
    onResendCode,
    onSign,
    testID = 'b2b-agreement',
}: AgreementPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { locale } = useLocale();

    const [typedName, setTypedName] = useState('');
    const [signatoryTitle, setSignatoryTitle] = useState('');
    const [authorityConfirmed, setAuthorityConfirmed] = useState(false);

    const stepped = verificationToken !== null && verificationToken.length > 0;
    const complete =
        typedName.trim().length > 0 && signatoryTitle.trim().length > 0 && authorityConfirmed;

    const signed = agreement.signature;
    const seller = agreement.seller;

    return (
        <View testID={testID} className="mt-[18px] flex-col gap-6 lg:flex-row lg:items-start">
            {/* The terms: who it is with, the summary, and the agreement in full. */}
            <View className="min-w-0 flex-col lg:flex-1">
                <View className="rounded-3xl border border-stroke-subtle bg-surface-raised px-6 py-[22px]">
                    <RNText
                        testID={`${testID}-title`}
                        className="font-display text-xl font-bold text-content-primary text-start"
                    >
                        {agreement.title}
                    </RNText>
                    <RNText className="mt-1 text-sm text-content-secondary text-start">
                        {t('b2bApplication:agreement.version', { version: agreement.version })}
                    </RNText>
                    {/* Who the company buys from, and at which list — the thing the terms are about. */}
                    {seller === null ? null : (
                        <RNText
                            testID={`${testID}-seller`}
                            className="mt-2 text-base font-medium text-content-primary text-start"
                        >
                            {t('b2bApplication:agreement.seller', {
                                seller: seller.organisationName,
                                priceList:
                                    locale === 'ar' && (seller.priceListNameAr ?? '') !== ''
                                        ? (seller.priceListNameAr ?? '')
                                        : seller.priceListNameEn,
                            })}
                        </RNText>
                    )}
                    {agreement.termsSummary === null ? null : (
                        <View
                            testID={`${testID}-summary`}
                            className="mt-4 rounded-2xl bg-surface-base px-4 py-3.5"
                        >
                            <RNText className="text-xs font-bold uppercase tracking-widest text-content-secondary text-start">
                                {t('b2bApplication:agreement.summaryTitle')}
                            </RNText>
                            <RNText className="mt-1.5 text-base font-medium leading-6 text-content-primary text-start">
                                {agreement.termsSummary}
                            </RNText>
                        </View>
                    )}
                    {/*
                     * No invoicing exists (PAY1 is discovery-gated). A payment term shown without
                     * this would imply a facility that will chase a balance, and none will.
                     */}
                    <View className="mt-4">
                        <ExtraNote
                            testID={`${testID}-no-invoicing`}
                            role="status"
                            icon="infoCircle"
                            title={t('b2bApplication:agreement.termsTitle')}
                            body={t('b2bApplication:agreement.noInvoicingYet')}
                        />
                    </View>
                </View>

                <ExtraCard
                    testID={`${testID}-document`}
                    title={t('b2bApplication:agreement.documentTitle')}
                >
                    <View className="mt-3 max-h-[420px] overflow-hidden rounded-[18px] bg-surface-base px-5 py-[18px]">
                        <RNText
                            testID={`${testID}-document-text`}
                            className="text-sm font-medium leading-6 text-content-secondary text-start"
                        >
                            {agreement.documentText}
                        </RNText>
                    </View>
                </ExtraCard>
            </View>

            {/* The two steps, in order: confirm it is you, then accept. */}
            <View className="w-full rounded-3xl border border-stroke-subtle bg-surface-raised px-6 py-[22px] lg:w-[400px]">
                {signed !== null ? (
                    <View testID={`${testID}-signed`} className="flex-col gap-3">
                        <ExtraNote
                            tone="ok"
                            icon="check"
                            title={t('b2bApplication:agreement.signedOn', {
                                date: formatter.formatDate(signed.signedAt),
                                name: signed.typedName,
                                role: signed.signatoryTitle,
                            })}
                            body={signed.consentStatement}
                        />
                        {/*
                         * `otpVerified` is carried on the evidence rather than assumed from the
                         * signature existing; when it is false the surface says so.
                         */}
                        {signed.otpVerified ? null : (
                            <ExtraNote
                                testID={`${testID}-not-stepped-up`}
                                tone="amber"
                                icon="warning"
                                title={t('b2bApplication:agreement.otpNotVerified')}
                            />
                        )}
                    </View>
                ) : (
                    <View className="flex-col">
                        <View testID={`${testID}-verify`} className="flex-col gap-3">
                            <StepLabel n={1} done={stepped}>
                                {t('b2bApplication:agreement.verifyTitle')}
                            </StepLabel>
                            <RNText className="text-sm leading-[21px] text-content-secondary text-start">
                                {t('b2bApplication:agreement.verifyBody')}
                            </RNText>

                            {challenge === null ? (
                                <View className="flex-row">
                                    <ExtraButton
                                        testID={`${testID}-request-code`}
                                        tone="secondary"
                                        label={t('b2bApplication:agreement.verifyTitle')}
                                        icon="send"
                                        busy={issuing}
                                        onPress={onRequestCode}
                                    />
                                </View>
                            ) : stepped ? (
                                <ExtraNote
                                    testID={`${testID}-verified`}
                                    tone="ok"
                                    icon="check"
                                    title={t('b2bApplication:agreement.verified')}
                                />
                            ) : (
                                <OtpChallengePanel
                                    testID={`${testID}-otp`}
                                    look="auth"
                                    challenge={challenge}
                                    failure={failure}
                                    verifying={verifying}
                                    resending={resending}
                                    onVerify={onVerifyCode}
                                    onResend={(channel) => {
                                        onResendCode(channel);
                                    }}
                                />
                            )}
                        </View>

                        <View
                            testID={`${testID}-sign`}
                            className="mt-[22px] flex-col gap-3 border-t border-stroke-subtle pt-[22px]"
                        >
                            <StepLabel n={2} done={false}>
                                {t('b2bApplication:agreement.signTitle')}
                            </StepLabel>

                            {/*
                             * The honesty block. Above the controls, not below them, and in the
                             * same weight as everything else on the page.
                             */}
                            <ExtraNote
                                testID={`${testID}-honesty`}
                                tone="amber"
                                icon="infoCircle"
                                title={t('b2bApplication:agreement.honestyTitle')}
                                body={t('b2bApplication:agreement.honestyBody')}
                            />

                            <RNText
                                testID={`${testID}-consent-statement`}
                                className="text-sm leading-[21px] text-content-secondary text-start"
                            >
                                {agreement.consentStatement}
                            </RNText>

                            <TextInputField
                                testID={`${testID}-typed-name`}
                                id={`${testID}-typed-name`}
                                label={t('b2bApplication:agreement.typedName')}
                                placeholder={t('b2bApplication:agreement.typedNamePlaceholder')}
                                hint={t('b2bApplication:agreement.typedNameHint')}
                                required
                                value={typedName}
                                onChangeText={setTypedName}
                            />
                            <TextInputField
                                testID={`${testID}-signatory-title`}
                                id={`${testID}-signatory-title`}
                                label={t('b2bApplication:agreement.signatoryTitle')}
                                placeholder={t(
                                    'b2bApplication:agreement.signatoryTitlePlaceholder',
                                )}
                                required
                                value={signatoryTitle}
                                onChangeText={setSignatoryTitle}
                            />
                            <Checkbox
                                testID={`${testID}-authority`}
                                id={`${testID}-authority`}
                                label={t('b2bApplication:agreement.authority')}
                                checked={authorityConfirmed}
                                onChange={setAuthorityConfirmed}
                            />

                            {stepped ? null : (
                                <View
                                    testID={`${testID}-verify-first`}
                                    role="status"
                                    aria-live="polite"
                                >
                                    <RNText className="text-sm font-medium text-warning-on-subtle text-start">
                                        {t('b2bApplication:agreement.verifyFirst')}
                                    </RNText>
                                </View>
                            )}

                            <ExtraButton
                                testID={`${testID}-submit`}
                                label={t('b2bApplication:agreement.sign')}
                                icon="arrowForward"
                                busy={signing}
                                disabled={!stepped || !complete}
                                onPress={() => {
                                    onSign({ typedName, signatoryTitle, authorityConfirmed });
                                }}
                            />
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
}

/** The board's numbered step label: a brand disc with the number (a tick once done). */
function StepLabel({
    n,
    done,
    children,
}: {
    readonly n: number;
    readonly done: boolean;
    readonly children: string;
}) {
    return (
        <View className="flex-row items-center gap-2.5">
            <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-brand">
                {done ? (
                    <Icon name="check" size="sm" className="text-content-on-brand" />
                ) : (
                    <RNText className="text-xs font-bold text-content-on-brand">{String(n)}</RNText>
                )}
            </View>
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="text-xs font-bold uppercase tracking-widest text-content-secondary text-start"
            >
                {children}
            </RNText>
        </View>
    );
}
