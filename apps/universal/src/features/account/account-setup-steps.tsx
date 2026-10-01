import type { AccountChecklistStep } from '@healthy360/api-client/contracts';
import { Button } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

/**
 * The account-setup steps a person still has to do, each as a row that says what it needs and goes
 * straight to the screen that does it.
 *
 * ## Why rows and not a link to the account page
 *
 * The server never answers "your account is not ready" without saying *why* — the placement
 * refusal carries one `account_not_ready` entry per outstanding requirement, and the account
 * checklist one item per step. A single "Finish setting up your account" link threw that away and
 * landed somebody on the top of the account page to guess which of six sections was the problem.
 * Each row here is one requirement: its name, one sentence of what it needs, and a button that opens
 * the screen that satisfies it. Shared by the checkout's refusal and the account page's notice, so
 * the two never describe the same step differently.
 */

/** The screen that completes each step. */
export const ACCOUNT_STEP_ROUTES: Readonly<Record<AccountChecklistStep, string>> = {
    verify_email: '/verify-email',
    verify_phone: '/customer/account/phone',
    add_address: '/customer/account/addresses',
    dietary_profile: '/customer/account/allergies',
    consents: '/customer/account/consents',
};

/**
 * The server's requirement code — the `outstanding` beside an `account_not_ready` placement refusal
 * — to the checklist step it names. The same table `api/account-repository.ts` reads the checklist
 * through, so a refusal and the account page always agree on which step is meant.
 */
const REQUIREMENT_STEPS: Readonly<Record<string, AccountChecklistStep>> = {
    'account.email_unverified': 'verify_email',
    'account.phone_unverified': 'verify_phone',
    'account.no_served_address': 'add_address',
    'account.dietary_declaration_missing': 'dietary_profile',
    'account.consents_outstanding': 'consents',
};

export function stepForRequirement(code: unknown): AccountChecklistStep | null {
    return typeof code === 'string' ? (REQUIREMENT_STEPS[code] ?? null) : null;
}

export interface AccountSetupStep {
    readonly step: AccountChecklistStep;
    /** Server-authored reason the step cannot be done yet; the row's button is disabled. */
    readonly blockedReason?: string | null | undefined;
    /**
     * For `add_address`: the person has an address, but none in an area that is served. The row
     * then says that, rather than asking for an address they already gave.
     */
    readonly hasAddress?: boolean | undefined;
}

export interface AccountSetupStepsProps {
    readonly steps: readonly AccountSetupStep[];
    readonly testID: string;
}

export function AccountSetupSteps({ steps, testID }: AccountSetupStepsProps) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <View testID={testID} className="flex-col gap-3">
            {steps.map(({ step, blockedReason, hasAddress }) => {
                const blocked = blockedReason !== undefined && blockedReason !== null;
                const body =
                    step === 'add_address' && hasAddress === true
                        ? t('account:checklist.steps.add_address.bodyOutsideArea')
                        : t(`account:checklist.steps.${step}.body`);
                return (
                    <View
                        key={step}
                        testID={`${testID}-${step}`}
                        className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-stroke-subtle bg-surface-raised px-4 py-3"
                    >
                        <View className="min-w-0 flex-1 basis-[220px] flex-col gap-hair">
                            <RNText className="text-sm font-semibold text-content-primary text-start">
                                {t(`account:checklist.steps.${step}.title`)}
                            </RNText>
                            <RNText
                                testID={
                                    blocked ? `${testID}-${step}-blocked` : `${testID}-${step}-body`
                                }
                                className="text-sm text-content-secondary text-start"
                            >
                                {blocked
                                    ? t('account:checklist.blocked', { reason: blockedReason })
                                    : body}
                            </RNText>
                        </View>
                        <Button
                            testID={`${testID}-${step}-open`}
                            size="sm"
                            label={t(`account:checklist.steps.${step}.action`)}
                            disabled={blocked}
                            onPress={() => {
                                router.push(ACCOUNT_STEP_ROUTES[step] as never);
                            }}
                        />
                    </View>
                );
            })}
        </View>
    );
}
