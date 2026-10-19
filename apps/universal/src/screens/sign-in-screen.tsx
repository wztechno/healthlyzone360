import { isRateLimitFailure, isValidationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';
import type { Translate } from '@healthy360/validation';
import {
    Button,
    Card,
    Checkbox,
    Heading,
    Inline,
    PasswordInput,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { makeLoginSchema, toFormResolver } from '@healthy360/validation';
import type { LoginInput, LoginValues } from '@healthy360/validation';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useStaffSignInDomainsQuery } from '../data/access-admin-hooks.ts';
import { toFailure, useLoginMutation, useTwoFactorChallengeMutation } from '../data/hooks.ts';
import { safeReturnTo, withReturnTo } from '../navigation/return-to.ts';
import { useKeepBrowsing } from '../navigation/use-keep-browsing.ts';
import { useCompleteAuth } from '../navigation/use-return-to.ts';
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
 * Sign in.
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
        <Stack testID="sign-in-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="sign-in-title">
                    {t('auth:login.title')}
                </Heading>
                <Text tone="secondary">{t('auth:login.subtitle')}</Text>
            </Stack>

            {formError === null ? null : (
                <Card tone="danger" padding="sm">
                    <Text testID="sign-in-error" tone="danger" role="alert" aria-live="assertive">
                        {formError}
                    </Text>
                </Card>
            )}

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
                    <PasswordInput
                        testID="sign-in-password"
                        id="sign-in-password"
                        label={t('auth:login.passwordLabel')}
                        placeholder={t('auth:login.passwordPlaceholder')}
                        autoComplete="current-password"
                        textContentType="password"
                        required
                        returnKeyType="go"
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        onSubmitEditing={submit}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="remember"
                render={({ field }) => (
                    <Checkbox
                        testID="sign-in-remember"
                        id="sign-in-remember"
                        label={t('auth:login.rememberLabel')}
                        checked={field.value === true}
                        onChange={field.onChange}
                    />
                )}
            />

            <Button
                testID="sign-in-submit"
                block
                label={t('auth:login.submit')}
                loading={login.isPending}
                onPress={submit}
            />

            {/* The marketplace browses without an account (4a): the way out of this form is a
                visible choice, not a back button. */}
            <Button
                testID="sign-in-keep-browsing"
                block
                variant="secondary"
                label={t('common:action.keepBrowsing')}
                onPress={keepBrowsing}
            />

            <Inline space="xs">
                <Link
                    testID="sign-in-forgot"
                    href={withReturnTo('/forgot-password', returnTo) as never}
                    replace
                    asChild
                >
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:login.forgotLink')}
                    </Text>
                </Link>
            </Inline>

            <Inline space="xs">
                <Text tone="secondary">{t('auth:login.registerPrompt')}</Text>
                <Link
                    testID="sign-in-register"
                    href={withReturnTo('/register', returnTo) as never}
                    replace
                    asChild
                >
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:login.registerLink')}
                    </Text>
                </Link>
            </Inline>
        </Stack>
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
            <Stack space="xs">
                <TextInputField
                    testID="sign-in-email"
                    id="sign-in-email"
                    label={t('auth:login.emailLabel')}
                    placeholder={t('auth:login.emailPlaceholder')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    required
                    returnKeyType="go"
                    value={typed}
                    onChangeText={setTyped}
                    onBlur={onBlur}
                    onSubmitEditing={onSubmit}
                    {...(error === undefined ? {} : { error })}
                />
                {domains.length === 0 ? null : (
                    <Inline space="xs">
                        <Button
                            testID="sign-in-use-sign-in-name"
                            variant="ghost"
                            size="sm"
                            label={t('auth:login.useSignInName')}
                            onPress={() => {
                                choose(domains[0]?.domain ?? null);
                            }}
                        />
                    </Inline>
                )}
            </Stack>
        );
    }

    return (
        <Stack space="xs" testID="sign-in-identity">
            <Inline space="sm" align="end" wrap>
                <TextInputField
                    testID="sign-in-local-part"
                    id="sign-in-local-part"
                    label={t('auth:login.signInNameLabel')}
                    placeholder={t('auth:login.signInNamePlaceholder')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="username"
                    required
                    returnKeyType="go"
                    value={typed}
                    onChangeText={setTyped}
                    onBlur={onBlur}
                    onSubmitEditing={onSubmit}
                    {...(error === undefined ? {} : { error })}
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
                ) : (
                    <Text testID="sign-in-domain-fixed" tone="secondary">
                        {`@${domain}`}
                    </Text>
                )}
            </Inline>

            {composed === '' ? null : (
                <Text variant="caption" tone="secondary" testID="sign-in-composed">
                    {t('auth:login.composedHint', { email: composed })}
                </Text>
            )}

            {domains.length > 1 ? null : (
                <Inline space="xs">
                    <Button
                        testID="sign-in-use-full-email"
                        variant="ghost"
                        size="sm"
                        label={t('auth:login.useFullEmail')}
                        onPress={() => {
                            choose(null);
                        }}
                    />
                </Inline>
            )}
        </Stack>
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
        <Stack testID="two-factor-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="two-factor-title">
                    {t('auth:login.twoFactor.title')}
                </Heading>
                <Text tone="secondary">{t('auth:login.twoFactor.subtitle')}</Text>
            </Stack>

            <TextInputField
                testID="two-factor-code"
                id="two-factor-code"
                label={
                    recovery
                        ? t('auth:login.twoFactor.recoveryLabel')
                        : t('auth:login.twoFactor.codeLabel')
                }
                hint={
                    recovery
                        ? t('auth:login.twoFactor.recoveryHint')
                        : t('auth:login.twoFactor.codeHint')
                }
                placeholder={
                    recovery
                        ? t('auth:login.twoFactor.recoveryPlaceholder')
                        : t('auth:login.twoFactor.codePlaceholder')
                }
                keyboardType={recovery ? 'default' : 'number-pad'}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                required
                returnKeyType="go"
                value={code}
                onChangeText={setCode}
                onSubmitEditing={submit}
                {...(error === null ? {} : { error })}
            />

            <Button
                testID="two-factor-submit"
                block
                label={t('auth:login.twoFactor.submit')}
                loading={challenge.isPending}
                onPress={submit}
            />

            <Inline space="sm">
                <Button
                    testID="two-factor-toggle-recovery"
                    variant="ghost"
                    size="sm"
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
                <Button
                    testID="two-factor-cancel"
                    variant="ghost"
                    size="sm"
                    label={t('auth:login.twoFactor.back')}
                    onPress={onCancel}
                />
            </Inline>
        </Stack>
    );
}
