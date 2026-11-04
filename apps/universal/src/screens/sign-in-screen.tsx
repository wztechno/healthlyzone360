import { isRateLimitFailure, isValidationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';
import type { Translate } from '@healthy360/validation';
import { Select } from '@healthy360/design-system';
import { makeLoginSchema, toFormResolver } from '@healthy360/validation';
import type { LoginInput, LoginValues } from '@healthy360/validation';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useStaffSignInDomainsQuery } from '../data/access-admin-hooks.ts';
import { toFailure, useLoginMutation, useTwoFactorChallengeMutation } from '../data/hooks.ts';
import { returnDestination, safeReturnTo, withReturnTo } from '../navigation/return-to.ts';
import { useKeepBrowsing } from '../navigation/use-keep-browsing.ts';
import { useCompleteAuth } from '../navigation/use-return-to.ts';
import {
    AuthBadge,
    AuthCheck,
    AuthError,
    AuthField,
    AuthHint,
    AuthLink,
    AuthReturnChip,
    AuthSubmit,
    AuthTabs,
    AuthTitle,
} from '../ui/auth-form.tsx';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

export interface SignInScreenProps {
    /** The route's raw `?returnTo=`. Validated here; an unsafe value is ignored. */
    readonly returnTo?: string | undefined;
}

/**
 * Sign in, drawn as the accepted Sign-in board in the sign-in frame: the Sign in / Create account
 * tabs, "Sign in" with the chip naming where finishing returns, the email (or a kitchen's sign-in
 * name with its domain inside the field) and the password with its eye, "Keep me signed in" beside
 * "Forgotten your password?", the Sign in pill, and "New to Healthy360? Create an account".
 *
 * Three server outcomes are handled distinctly, because collapsing them is what makes an
 * authentication screen frustrating:
 *
 * * `validation.failed` → mapped onto the offending field, inline.
 * * `rate_limit.exceeded` → a message that says *how long*, not just "too many attempts".
 * * `two_factor_required` → not an error at all; the form advances to the challenge step.
 *
 * ## Where it finishes
 *
 * `?returnTo=` is the page that sent the person here — a gate that refused `/customer/checkout`, the
 * header on a kitchen's page, an Add to basket. Both ways of finishing (the password, and the
 * second factor after it) go through `useCompleteAuth`, which replaces this entry with the launch
 * resolver carrying that return: the resolver alone knows whether the session may be there yet or
 * still owes an email confirmation first. With no return it is `replace('/')`, exactly as before.
 *
 * The cross-links to registration and the reset form **replace** rather than push and carry the
 * return, so a finished sign-in leaves no trail of auth forms behind Back (AUTH-05).
 */
export function SignInScreen({ returnTo: rawReturnTo }: SignInScreenProps = {}) {
    const { t } = useTranslation();
    const login = useLoginMutation();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const completeAuth = useCompleteAuth();
    const returnTo = safeReturnTo(rawReturnTo);
    // The way out without signing in — see `navigation/use-keep-browsing.ts`.
    const keepBrowsing = useKeepBrowsing(returnTo);
    const router = useRouter();
    const destination = returnTo === null ? null : returnDestination(returnTo);
    const toRegister = () => {
        router.replace(withReturnTo('/register', returnTo) as never);
    };

    const [challengeId, setChallengeId] = useState<string | null>(null);

    const form = useForm<LoginInput, unknown, LoginValues>({
        resolver: toFormResolver(makeLoginSchema(translate)),
        defaultValues: { email: '', password: '', remember: false },
        mode: 'onSubmit',
    });

    const { formError, setFormError } = useFieldErrors();

    const onSubmit = useCallback(
        (values: LoginValues) => {
            setFormError(null);
            login.mutate(
                { email: values.email, password: values.password, remember: values.remember },
                {
                    onSuccess: (result) => {
                        if (result.status === 'two_factor_required') {
                            setChallengeId(result.challengeId);
                            return;
                        }
                        completeAuth(returnTo);
                    },
                    onError: (error: unknown) => {
                        const failure = toFailure(error);
                        setFormError(
                            applyServerFailure(failure, form.setError, ['email', 'password']) ??
                                signInFailureMessage(failure, describeFailure, translate),
                        );
                    },
                },
            );
        },
        [completeAuth, describeFailure, form, login, returnTo, setFormError, translate],
    );

    // One path for the button and for Enter in either field, so the keyboard signs in exactly as
    // the button does. A second Enter while the first request is out does not send another.
    const submit = () => {
        if (login.isPending) return;
        void form.handleSubmit(onSubmit)();
    };

    if (challengeId !== null) {
        return (
            <TwoFactorChallenge
                challengeId={challengeId}
                onSignedIn={() => {
                    completeAuth(returnTo);
                }}
                onCancel={() => {
                    setChallengeId(null);
                }}
            />
        );
    }

    return (
        <View testID="sign-in-screen" className="flex-col gap-3.5">
            <AuthTabs
                value="in"
                label={t('auth:frame.tabsLabel')}
                signInLabel={t('auth:login.title')}
                createLabel={t('auth:register.submit')}
                onSignIn={() => undefined}
                onCreate={toRegister}
            />

            <View className="mt-3 flex-row flex-wrap items-center justify-between gap-3">
                <AuthTitle testID="sign-in-title">{t('auth:login.title')}</AuthTitle>
                {destination === null || destination === 'previous' ? null : (
                    <AuthReturnChip
                        testID="sign-in-return"
                        label={t(`common:destination.${destination}`)}
                    />
                )}
            </View>

            {formError === null ? null : <AuthError testID="sign-in-error" message={formError} />}

            <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                    <SignInIdentityField
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        onSubmit={submit}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="sign-in-password"
                        label={t('auth:login.passwordLabel')}
                        icon="lock"
                        placeholder={t('auth:login.passwordPlaceholder')}
                        autoComplete="current-password"
                        textContentType="password"
                        returnKeyType="go"
                        secret
                        showLabel={t('auth:changePassword.showPassword')}
                        hideLabel={t('auth:changePassword.hidePassword')}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        onSubmitEditing={submit}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <View className="flex-row flex-wrap items-center justify-between gap-3">
                <Controller
                    control={form.control}
                    name="remember"
                    render={({ field }) => (
                        <AuthCheck
                            testID="sign-in-remember"
                            label={t('auth:login.rememberLabel')}
                            checked={field.value === true}
                            onChange={field.onChange}
                        />
                    )}
                />
                <AuthTextLink
                    testID="sign-in-forgot"
                    label={t('auth:login.forgotLink')}
                    onPress={() => {
                        router.replace(withReturnTo('/forgot-password', returnTo) as never);
                    }}
                />
            </View>

            <AuthSubmit
                testID="sign-in-submit"
                label={t('auth:login.submit')}
                busy={login.isPending}
                onPress={submit}
            />

            <View className="mt-4 flex-row flex-wrap items-center justify-center gap-x-1">
                <RNText className="text-sm font-medium text-content-secondary">
                    {t('auth:login.registerPrompt')}
                </RNText>
                <AuthTextLink
                    testID="sign-in-register"
                    label={t('auth:login.registerLink')}
                    onPress={toRegister}
                />
            </View>

            {/* The marketplace browses without an account (4a): the way out of this form is a
                visible choice as well as the frame's Back to the shop. */}
            <AuthLink
                testID="sign-in-keep-browsing"
                label={t('common:action.keepBrowsing')}
                onPress={keepBrowsing}
            />
        </View>
    );
}

/** An inline text link in the boards' brand ink — "Forgotten your password?", "Create an account". */
function AuthTextLink({
    testID,
    label,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly onPress: () => void;
}) {
    return (
        <RNText
            testID={testID}
            role="link"
            accessibilityRole="link"
            onPress={onPress}
            className="min-h-touch py-3 text-sm font-semibold text-content-on-brand-subtle hover:underline"
        >
            {label}
        </RNText>
    );
}

/** The `Select` value that means "I am not staff — let me type the whole address." */
const FULL_EMAIL = '__full__';

/**
 * Compose what a kitchen employee typed into the address Fortify will actually be asked about.
 *
 * Two rules, and the second is what keeps this screen usable by everybody:
 *
 * * an empty local part composes to nothing, so the field reads as empty rather than as `@kitchen`;
 * * **a local part containing `@` is already an address and passes through untouched.** A consumer
 *   who types `me@example.com` into a field captioned "Sign-in name" signs in, and the hint below
 *   shows them the address that will be sent. Without this the picker would be a trap for the one
 *   audience that has no kitchen to pick.
 */
export function composeSignInEmail(localPart: string, domain: string | null): string {
    const typed = localPart.trim();
    if (typed === '') return '';
    if (domain === null || typed.includes('@')) return typed;
    return `${typed}@${domain}`;
}

interface SignInIdentityFieldProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly onBlur: () => void;
    /** Enter in the field — signs in, like the button. */
    readonly onSubmit: () => void;
    readonly error?: string | undefined;
}

/**
 * The email field, split in two when the deployment has staff domains to offer.
 *
 * A kitchen employee's address is `name@kitchen.healthy360.app`, and the half after the `@` is the
 * same for everyone who works there. Making them type it is a spelling test they can fail at the
 * one moment they need to get in. So the domain becomes a control the screen supplies and the
 * person types only their name.
 *
 * What renders depends on how many domains exist, because a dropdown with one option is not a
 * choice:
 *
 * * **none** — today's plain address field, untouched. A deployment with no staff domains sees no
 *   change at all;
 * * **one** — the name field with the domain fixed beside it, and an explicit way back to the full
 *   address;
 * * **two or more** — the name field with a picker, whose last option is that same way back.
 *
 * The composed address is always shown. Whatever the mode, the reader can see the exact string
 * that will be submitted before they submit it.
 */
function SignInIdentityField({
    value,
    onChange,
    onBlur,
    onSubmit,
    error,
}: SignInIdentityFieldProps) {
    const { t } = useTranslation();
    const domainsQuery = useStaffSignInDomainsQuery();
    const domains = domainsQuery.data ?? [];

    // One source of truth for what the person typed, whichever control they typed it into. Two
    // states — a local part and an address — would drift the moment the query resolves under a
    // half-typed field and swapped the control out from under it.
    const [typed, setTyped] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);
    const [touchedChoice, setTouchedChoice] = useState(false);

    // The first domain is the default because a kitchen with one is the case this exists for; a
    // consumer is not stranded by it, since typing an `@` opts out of composition on its own.
    const domain = touchedChoice ? chosen : (domains[0]?.domain ?? null);
    const composed = composeSignInEmail(typed, domain);

    // The domain arrives from the network, so it can land after the first keystroke. Recomposing
    // here is what keeps the submitted address equal to the one the hint is showing.
    useEffect(() => {
        if (composed !== value) onChange(composed);
    }, [composed, onChange, value]);

    const choose = (next: string | null) => {
        setTouchedChoice(true);
        setChosen(next);
    };

    if (domains.length === 0 || domain === null) {
        return (
            <View className="flex-col gap-1.5">
                <AuthField
                    testID="sign-in-email"
                    label={t('auth:login.emailLabel')}
                    icon="send"
                    placeholder={t('auth:login.emailPlaceholder')}
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="go"
                    value={typed}
                    onChangeText={setTyped}
                    onBlur={onBlur}
                    onSubmitEditing={onSubmit}
                    error={error}
                />
                {domains.length === 0 ? null : (
                    <AuthLink
                        testID="sign-in-use-sign-in-name"
                        label={t('auth:login.useSignInName')}
                        onPress={() => {
                            choose(domains[0]?.domain ?? null);
                        }}
                    />
                )}
            </View>
        );
    }

    return (
        <View className="flex-col gap-1.5" testID="sign-in-identity">
            <AuthField
                testID="sign-in-local-part"
                label={t('auth:login.signInNameLabel')}
                icon="user"
                placeholder={t('auth:login.signInNamePlaceholder')}
                keyboardType="email-address"
                autoComplete="username"
                returnKeyType="go"
                value={typed}
                onChangeText={setTyped}
                onBlur={onBlur}
                onSubmitEditing={onSubmit}
                error={error}
                {...(domains.length > 1
                    ? {}
                    : { suffix: `@${domain}`, suffixTestID: 'sign-in-domain-fixed' })}
            />

            {domains.length > 1 ? (
                <Select
                    testID="sign-in-domain"
                    label={t('auth:login.domainLabel')}
                    options={[
                        ...domains.map((entry) => ({
                            value: entry.domain,
                            label: `@${entry.domain}`,
                            description: entry.organisationName,
                        })),
                        { value: FULL_EMAIL, label: t('auth:login.domainFull') },
                    ]}
                    value={domain}
                    onChange={(next) => {
                        choose(next === FULL_EMAIL ? null : next);
                    }}
                />
            ) : null}

            {composed === '' ? null : (
                <View testID="sign-in-composed">
                    <AuthHint>{t('auth:login.composedHint', { email: composed })}</AuthHint>
                </View>
            )}

            {domains.length > 1 ? null : (
                <AuthLink
                    testID="sign-in-use-full-email"
                    label={t('auth:login.useFullEmail')}
                    onPress={() => {
                        choose(null);
                    }}
                />
            )}
        </View>
    );
}

/**
 * Sign-in has its own wording for two codes, because the generic ones are not good enough here: a
 * rate limit must say *how long*, and a rejected credential should not read like a server fault.
 */
function signInFailureMessage(
    failure: ApiFailure | null,
    fallback: (failure: ApiFailure | null) => string | null,
    t: Translate,
): string | null {
    if (failure === null) return null;
    if (isRateLimitFailure(failure)) {
        return t('auth:login.rateLimited', { seconds: failure.retryAfterSeconds });
    }
    if (failure.code === 'auth.invalid_credentials') return t('auth:login.failed');
    return fallback(failure);
}

interface TwoFactorChallengeProps {
    readonly challengeId: string;
    /** The session exists now; the sign-in screen finishes it the way a password-only one does. */
    readonly onSignedIn: () => void;
    readonly onCancel: () => void;
}

/**
 * The second step of sign-in.
 *
 * Recovery codes are offered as a *mode switch* rather than a second always-visible field: two
 * inputs where only one applies is the classic way people lock themselves out of their own account.
 */
function TwoFactorChallenge({ challengeId, onSignedIn, onCancel }: TwoFactorChallengeProps) {
    const { t } = useTranslation();
    const challenge = useTwoFactorChallengeMutation();
    const describeFailure = useFailureMessage();

    const [code, setCode] = useState('');
    const [recovery, setRecovery] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = () => {
        if (challenge.isPending) return;
        setError(null);
        challenge.mutate(
            { challengeId, code, recovery },
            {
                onSuccess: onSignedIn,
                onError: (caught: unknown) => {
                    const failure = toFailure(caught);
                    if (failure !== null && isValidationFailure(failure)) {
                        setError(failure.fields['code']?.[0] ?? failure.message);
                        return;
                    }
                    setError(describeFailure(failure));
                },
            },
        );
    };

    return (
        <View testID="two-factor-screen" className="flex-col gap-3.5">
            <View className="items-center">
                <AuthBadge icon="shield" round />
            </View>
            <AuthTitle testID="two-factor-title" centred>
                {t('auth:login.twoFactor.title')}
            </AuthTitle>

            <AuthField
                testID="two-factor-code"
                label={
                    recovery
                        ? t('auth:login.twoFactor.recoveryLabel')
                        : t('auth:login.twoFactor.codeLabel')
                }
                icon={recovery ? 'keyRound' : 'shield'}
                placeholder={
                    recovery
                        ? t('auth:login.twoFactor.recoveryPlaceholder')
                        : t('auth:login.twoFactor.codePlaceholder')
                }
                keyboardType={recovery ? 'default' : 'number-pad'}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                returnKeyType="go"
                value={code}
                onChangeText={setCode}
                onSubmitEditing={submit}
                error={error ?? undefined}
            />
            <AuthHint>
                {recovery
                    ? t('auth:login.twoFactor.recoveryHint')
                    : t('auth:login.twoFactor.codeHint')}
            </AuthHint>

            <AuthSubmit
                testID="two-factor-submit"
                label={t('auth:login.twoFactor.submit')}
                busy={challenge.isPending}
                onPress={submit}
            />

            <AuthLink
                testID="two-factor-toggle-recovery"
                label={
                    recovery
                        ? t('auth:login.twoFactor.useCode')
                        : t('auth:login.twoFactor.useRecovery')
                }
                onPress={() => {
                    setRecovery((current) => !current);
                    setCode('');
                    setError(null);
                }}
            />
            <AuthLink
                testID="two-factor-cancel"
                label={t('auth:login.twoFactor.back')}
                onPress={onCancel}
            />
        </View>
    );
}
