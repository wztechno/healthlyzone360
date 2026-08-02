import type { ApiFailure } from '@healthy360/api-client';
import {
    Button,
    Callout,
    Card,
    Checkbox,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OtpChallengePanel } from '../verification/otp-challenge-panel.tsx';
import type { OtpChallengeView } from '../verification/otp-challenge-panel.tsx';
import type { B2BAgreement } from './repositories-shim.ts';

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

    const [typedName, setTypedName] = useState('');
    const [signatoryTitle, setSignatoryTitle] = useState('');
    const [authorityConfirmed, setAuthorityConfirmed] = useState(false);

    const stepped = verificationToken !== null && verificationToken.length > 0;
    const complete =
        typedName.trim().length > 0 && signatoryTitle.trim().length > 0 && authorityConfirmed;

    const signed = agreement.signature;

    return (
        <Stack testID={testID} space="lg">
            <Stack space="xs">
                <Text variant="bodyStrong" testID={`${testID}-title`}>
                    {agreement.title}
                </Text>
                <Text tone="secondary" variant="caption">
                    {t('b2bApplication:agreement.version', { version: agreement.version })}
                </Text>
            </Stack>

            {agreement.termsSummary === null ? null : (
                <Card
                    testID={`${testID}-summary`}
                    title={t('b2bApplication:agreement.summaryTitle')}
                >
                    <Text>{agreement.termsSummary}</Text>
                </Card>
            )}

            {/*
             * No invoicing exists (PAY1 is discovery-gated). A payment term shown without this
             * would imply a facility that will chase a balance, and none will.
             */}
            <Callout
                testID={`${testID}-no-invoicing`}
                tone="info"
                role="note"
                title={t('b2bApplication:agreement.termsTitle')}
                body={t('b2bApplication:agreement.noInvoicingYet')}
            />

            <Card testID={`${testID}-document`} title={t('b2bApplication:agreement.documentTitle')}>
                <Text variant="mono" testID={`${testID}-document-text`}>
                    {agreement.documentText}
                </Text>
            </Card>

            {signed !== null ? (
                <Stack space="sm" testID={`${testID}-signed`}>
                    <Callout
                        tone="success"
                        role="status"
                        title={t('b2bApplication:agreement.signedOn', {
                            date: signed.signedAt,
                            name: signed.typedName,
                            role: signed.signatoryTitle,
                        })}
                        body={signed.consentStatement}
                    />
                    {/*
                     * `otpVerified` is carried on the evidence rather than assumed from the
                     * signature existing. When it is false the surface says so — the B1 backend
                     * records exactly that until the integrator closes the OTP seam, and a screen
                     * that drew "identity verified" from a signature would be reporting a check
                     * nobody performed.
                     */}
                    {signed.otpVerified ? null : (
                        <Callout
                            testID={`${testID}-not-stepped-up`}
                            tone="warning"
                            role="note"
                            title={t('b2bApplication:agreement.otpNotVerified')}
                        />
                    )}
                </Stack>
            ) : (
                <Stack space="lg">
                    <Stack space="sm" testID={`${testID}-verify`}>
                        <Text variant="bodyStrong">
                            {t('b2bApplication:agreement.verifyTitle')}
                        </Text>
                        <Text tone="secondary">{t('b2bApplication:agreement.verifyBody')}</Text>

                        {challenge === null ? (
                            <Button
                                testID={`${testID}-request-code`}
                                variant="secondary"
                                label={t('b2bApplication:agreement.verifyTitle')}
                                loading={issuing}
                                onPress={onRequestCode}
                            />
                        ) : stepped ? (
                            <Callout
                                testID={`${testID}-verified`}
                                tone="success"
                                role="status"
                                title={t('b2bApplication:agreement.verified')}
                            />
                        ) : (
                            <OtpChallengePanel
                                testID={`${testID}-otp`}
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
                    </Stack>

                    <Stack space="sm" testID={`${testID}-sign`}>
                        <Text variant="bodyStrong">{t('b2bApplication:agreement.signTitle')}</Text>

                        {/*
                         * The honesty block. Above the controls, not below them, and in the same
                         * weight as everything else on the page.
                         */}
                        <Callout
                            testID={`${testID}-honesty`}
                            tone="info"
                            role="note"
                            title={t('b2bApplication:agreement.honestyTitle')}
                            body={t('b2bApplication:agreement.honestyBody')}
                        />

                        <Text testID={`${testID}-consent-statement`} tone="secondary">
                            {agreement.consentStatement}
                        </Text>

                        <TextInputField
                            testID={`${testID}-typed-name`}
                            id={`${testID}-typed-name`}
                            label={t('b2bApplication:agreement.typedName')}
                            hint={t('b2bApplication:agreement.typedNameHint')}
                            required
                            value={typedName}
                            onChangeText={setTypedName}
                        />
                        <TextInputField
                            testID={`${testID}-signatory-title`}
                            id={`${testID}-signatory-title`}
                            label={t('b2bApplication:agreement.signatoryTitle')}
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
                                <Text tone="warning" variant="caption">
                                    {t('b2bApplication:agreement.verifyFirst')}
                                </Text>
                            </View>
                        )}

                        <Button
                            testID={`${testID}-submit`}
                            label={t('b2bApplication:agreement.sign')}
                            loading={signing}
                            disabled={!stepped || !complete}
                            onPress={() => {
                                onSign({ typedName, signatoryTitle, authorityConfirmed });
                            }}
                        />
                    </Stack>
                </Stack>
            )}
        </Stack>
    );
}
