import type { AccountChecklistStep } from '@healthy360/api-client/contracts';
import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { withReturnTo } from '../../navigation/return-to.ts';

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
 * Each row here is one requirement: its name, one sentence of what it needs, and the action that
 * opens the screen that satisfies it. Shared by the checkout's refusal, the plan setup's refusal and
 * the account page's notice, so the three never describe the same step differently.
 *
 * ## The whole card is the control
 *
 * A numbered card per step — the number says "there is an order to this, and it is short" — and the
 * card itself is the press target, not a small button at its edge: the step is one decision ("go and
 * do this"), and a 44px card is a far easier thing to hit on a phone than a `sm` button. The action
 * label and a chevron sit at the end so the card still reads as something that goes somewhere. A
 * step the server says cannot be done yet is drawn inert, with the reason in place of its body.
 *
 * ## Each step comes back
 *
 * A row opens its screen with the page that listed it as `?returnTo=` — the checkout with its
 * address, date and window, the plan setup on its step, the account on its section — and that screen
 * returns there once the step is done. A step is a detour, never a destination.
 */

/** The screen that completes each step. */
export const ACCOUNT_STEP_ROUTES: Readonly<Record<AccountChecklistStep, string>> = {
    verify_email: '/verify-email',
    verify_phone: '/customer/account/phone',
    // Straight to the form: a person with no address has nothing to pick from a list.
    add_address: '/customer/account/addresses/new',
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
    /** The page listing the steps, which each step's screen returns to once it is done. */
    readonly returnTo?: string | undefined;
    readonly testID: string;
}

export function AccountSetupSteps({ steps, returnTo, testID }: AccountSetupStepsProps) {
    const { t } = useTranslation();
    const router = useRouter();
    // The action's words from `md`; below it the chevron alone, so the title keeps the width.
    const wide = useBreakpoint().atLeast('md');

    return (
        <View testID={testID} role="list" className="flex-col gap-2">
            {steps.map(({ step, blockedReason, hasAddress }, index) => {
                const blocked = blockedReason !== undefined && blockedReason !== null;
                const title = t(`account:checklist.steps.${step}.title`);
                const action = t(`account:checklist.steps.${step}.action`);
                const body =
                    step === 'add_address' && hasAddress === true
                        ? t('account:checklist.steps.add_address.bodyOutsideArea')
                        : t(`account:checklist.steps.${step}.body`);
                return (
                    <View key={step} role="listitem" testID={`${testID}-${step}`}>
                        <Pressable
                            testID={`${testID}-${step}-open`}
                            role="link"
                            accessibilityRole="link"
                            accessibilityLabel={`${title}. ${action}`}
                            accessibilityState={{ disabled: blocked }}
                            aria-disabled={blocked}
                            disabled={blocked}
                            onPress={() => {
                                router.push(
                                    withReturnTo(ACCOUNT_STEP_ROUTES[step], returnTo) as never,
                                );
                            }}
                            className={cx(
                                'min-h-touch flex-row items-center gap-4 rounded-lg border bg-surface-raised px-4 py-3',
                                blocked
                                    ? 'border-stroke-subtle opacity-60'
                                    : 'border-stroke hover:border-surface-brand hover:bg-surface-sunken',
                            )}
                        >
                            <View
                                aria-hidden
                                className={cx(
                                    'h-8 w-8 items-center justify-center rounded-full',
                                    blocked ? 'bg-surface-sunken' : 'bg-surface-brand-subtle',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'text-sm font-semibold tabular-nums',
                                        blocked
                                            ? 'text-content-secondary'
                                            : 'text-content-on-brand-subtle',
                                    )}
                                >
                                    {index + 1}
                                </RNText>
                            </View>
                            <View className="min-w-0 flex-1 flex-col gap-0.5">
                                <RNText className="self-start text-sm font-semibold text-content-primary text-start">
                                    {title}
                                </RNText>
                                <RNText
                                    testID={
                                        blocked
                                            ? `${testID}-${step}-blocked`
                                            : `${testID}-${step}-body`
                                    }
                                    className="self-start text-sm text-content-secondary text-start"
                                >
                                    {blocked
                                        ? t('account:checklist.blocked', { reason: blockedReason })
                                        : body}
                                </RNText>
                            </View>
                            {blocked ? null : (
                                <View className="shrink-0 flex-row items-center gap-1">
                                    {wide ? (
                                        <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                            {action}
                                        </RNText>
                                    ) : null}
                                    <Icon
                                        name="chevronEnd"
                                        size="sm"
                                        className="text-content-on-brand-subtle"
                                    />
                                </View>
                            )}
                        </Pressable>
                    </View>
                );
            })}
        </View>
    );
}

export interface AccountSetupPanelProps {
    readonly title: string;
    readonly body: string;
    readonly steps: readonly AccountSetupStep[];
    /** Where each step returns once it is done — the page drawing the panel. */
    readonly returnTo?: string | undefined;
    /** `alert` where a refusal just happened (checkout); `status` where it is standing news. */
    readonly role?: 'alert' | 'status' | undefined;
    readonly testID: string;
    /** The steps' own testID prefix. */
    readonly stepsTestID: string;
}

/**
 * The steps under their heading, on the page itself rather than inside a tinted box. The cards
 * already carry the weight — numbered, bordered, each a press target — and a warning fill around
 * them only made a to-do list read as an error. The heading says what is wanted; the cards are how.
 */
export function AccountSetupPanel({
    title,
    body,
    steps,
    returnTo,
    role = 'status',
    testID,
    stepsTestID,
}: AccountSetupPanelProps) {
    return (
        <View
            testID={testID}
            role={role}
            {...(role === 'alert'
                ? { accessibilityRole: 'alert' as const }
                : { 'aria-live': 'polite' as const })}
            className="flex-col gap-3"
        >
            <View className="flex-col gap-0.5">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="self-start text-base font-semibold text-content-primary text-start"
                >
                    {title}
                </RNText>
                <RNText className="self-start text-sm text-content-secondary text-start">
                    {body}
                </RNText>
            </View>
            <AccountSetupSteps steps={steps} returnTo={returnTo} testID={stepsTestID} />
        </View>
    );
}
