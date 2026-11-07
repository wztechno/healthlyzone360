import type { AccountChecklistStep } from '@healthy360/api-client/contracts';
import { Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
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

/** Each step's mark on its tile. */
const STEP_ICONS: Readonly<Record<AccountChecklistStep, IconName>> = {
    verify_email: 'send',
    verify_phone: 'smartphone',
    add_address: 'mapPin',
    dietary_profile: 'shield',
    consents: 'clipboardCheck',
};

export function AccountSetupSteps({ steps, returnTo, testID }: AccountSetupStepsProps) {
    const { t } = useTranslation();
    const router = useRouter();
    // One row of tiles from `md`; stacked below it, so each title keeps its width.
    const row = useBreakpoint().atLeast('md');

    return (
        <View testID={testID} role="list" className={cx('gap-2.5', row ? 'flex-row' : 'flex-col')}>
            {steps.map(({ step, blockedReason, hasAddress }) => {
                const blocked = blockedReason !== undefined && blockedReason !== null;
                const title = t(`account:checklist.steps.${step}.title`);
                const action = t(`account:checklist.steps.${step}.action`);
                const outsideArea = step === 'add_address' && hasAddress === true;
                return (
                    <View
                        key={step}
                        role="listitem"
                        testID={`${testID}-${step}`}
                        className={row ? 'min-w-0 flex-1' : ''}
                    >
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
                                'min-h-[72px] flex-1 flex-row items-center gap-3 rounded-[18px] border-[1.5px] bg-surface-base px-3.5 py-3',
                                blocked
                                    ? 'border-dashed border-stroke-subtle opacity-70'
                                    : 'border-stroke-subtle hover:border-surface-brand hover:bg-surface-brand-subtle',
                            )}
                        >
                            <View
                                aria-hidden
                                className="h-9 w-9 items-center justify-center rounded-xl border border-stroke-subtle bg-surface-raised"
                            >
                                <Icon
                                    name={STEP_ICONS[step]}
                                    size="md"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <View className="min-w-0 flex-1 flex-col gap-0.5">
                                <RNText className="self-start text-sm font-bold leading-[18px] text-content-primary text-start">
                                    {title}
                                </RNText>
                                <RNText
                                    testID={
                                        blocked
                                            ? `${testID}-${step}-blocked`
                                            : `${testID}-${step}-body`
                                    }
                                    className={cx(
                                        'self-start text-xs font-semibold text-start',
                                        blocked || outsideArea
                                            ? 'text-content-secondary'
                                            : 'text-content-on-brand-subtle',
                                    )}
                                >
                                    {blocked
                                        ? t('account:checklist.blocked', { reason: blockedReason })
                                        : outsideArea
                                          ? t('account:checklist.steps.add_address.bodyOutsideArea')
                                          : action}
                                </RNText>
                            </View>
                            {blocked ? null : (
                                <Icon
                                    name="chevronEnd"
                                    size="sm"
                                    className="text-content-secondary"
                                />
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
 * "Finish setting up your account" as one card (Shop · Plan setup pin 6, Basket + checkout pin 1,
 * the account page): an amber person tile with the heading and how many steps are left, beside a
 * row of step tiles — each its mark, its title and what pressing it does. Stacked on a phone.
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
    const wide = useBreakpoint().atLeast('lg');
    return (
        <View
            testID={testID}
            role={role}
            {...(role === 'alert'
                ? { accessibilityRole: 'alert' as const }
                : { 'aria-live': 'polite' as const })}
            className={cx(
                'gap-[18px] rounded-3xl border border-stroke-subtle bg-surface-raised p-[18px] shadow-elevation-2',
                wide ? 'flex-row items-center' : 'flex-col',
            )}
        >
            <View className={cx('flex-row items-start gap-3', wide ? 'w-[300px]' : null)}>
                <View
                    aria-hidden
                    className="h-11 w-11 items-center justify-center rounded-[14px] bg-warning-subtle"
                >
                    <Icon name="person" size="md" className="text-warning-on-subtle" />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="self-start font-display text-base font-bold leading-[21px] text-content-primary text-start"
                    >
                        {title}
                    </RNText>
                    <RNText className="mt-1 self-start text-sm text-content-secondary text-start">
                        {body}
                    </RNText>
                </View>
            </View>
            <View className={wide ? 'min-w-0 flex-1' : ''}>
                <AccountSetupSteps steps={steps} returnTo={returnTo} testID={stepsTestID} />
            </View>
        </View>
    );
}
