import {
    PASSWORD_MIN_LENGTH,
    makeUpdatePasswordSchema,
    toFormResolver,
} from '@healthy360/validation';
import type { UpdatePasswordValues } from '@healthy360/validation';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useUpdatePasswordMutation } from '../data/hooks.ts';
import { availableWorkspaceAreas } from '../navigation/items.ts';
import { useCompleteAuth, useReturnTo } from '../navigation/use-return-to.ts';
import { useAccessState } from '../session/session-provider.tsx';
import {
    AuthBadge,
    AuthError,
    AuthField,
    AuthHint,
    AuthLink,
    AuthSubmit,
    AuthText,
    AuthTick,
    AuthTitle,
} from '../ui/auth-form.tsx';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

const KNOWN_FIELDS = ['current_password', 'password', 'password_confirmation'] as const;

/** Where a voluntary change returns when it was opened without a `?returnTo=`. */
const CUSTOMER_FALLBACK = '/customer/account?section=profile';
const STAFF_FALLBACK = '/profile';

export interface ChangePasswordScreenProps {
    /** The route's raw `?returnTo=`. Validated by `useReturnTo`. */
    readonly returnTo?: string | undefined;
}

/**
 * Change password, from inside a live session, drawn as the accepted Change-password board in the
 * sign-in frame (`ui/auth-frame.tsx`): the key badge, the title, the three fields with one eye for
 * the new password and its confirmation, the length hint and "Save and continue"; then the tick and
 * "Password changed".
 *
 * This is where `resolveLandingRoute()` parks a person whose account an administrator opened for
 * them. The distinction it draws matters: an account that *must* change reads as an obligation —
 * "Choose your own password", over "The password you were given" — while anybody arriving here by
 * choice gets "Change your password" and a Cancel. Same fields, different words, and the difference
 * is what stops the forced case reading like an error the person caused.
 *
 * Unlike a reset, the session survives, so success continues into the application rather than
 * bouncing back to the sign-in form.
 *
 * ## Two ways out, because two ways in
 *
 * - **Forced.** The route out is the launch resolver (`useCompleteAuth`), on a `/me` the mutation
 *   has already invalidated: the flag is now false, and the same resolver that sent them here
 *   sends them on — to the `?returnTo=` the landing carried, when there was one, else to their
 *   workspace. There is no Cancel: the change is the obligation.
 * - **By choice** (ACCOUNT-10). Opened from a settings page, so it behaves like any other detour:
 *   Cancel goes back where it came from, and Continue after success returns there too — by
 *   `dismissTo`, so the finished form is not what Back shows next. Opened bare, the fallback is the
 *   page that links here: a member of staff's profile, or a customer's account.
 *
 * Which of the two it was is fixed at submit time. The success refetches `/me`, and reading the
 * flag again on the confirmation would always say "by choice".
 */
export function ChangePasswordScreen({ returnTo }: ChangePasswordScreenProps = {}) {
    const { t } = useTranslation();
    const update = useUpdatePasswordMutation();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const { formError, setFormError } = useFieldErrors();
    const [done, setDone] = useState<'forced' | 'voluntary' | null>(null);
    // The board's one eye for the new password and its confirmation: shown together or not at all.
    const [revealed, setRevealed] = useState(false);

    const accessState = useAccessState();
    const forced = accessState.mustChangePassword === true;
    const isStaff = availableWorkspaceAreas(accessState).some(
        (option) => option.area !== 'customer' && option.available,
    );
    const back = useReturnTo(returnTo, isStaff ? STAFF_FALLBACK : CUSTOMER_FALLBACK);
    const completeAuth = useCompleteAuth();

    const form = useForm<
        { current_password: string; password: string; password_confirmation: string },
        unknown,
        UpdatePasswordValues
    >({
        resolver: toFormResolver(makeUpdatePasswordSchema(translate)),
        defaultValues: { current_password: '', password: '', password_confirmation: '' },
        mode: 'onSubmit',
    });

    const onSubmit = useCallback(
        (values: UpdatePasswordValues) => {
            setFormError(null);
            update.mutate(
                {
                    currentPassword: values.current_password,
                    password: values.password,
                    passwordConfirmation: values.password_confirmation,
                },
                {
                    onSuccess: () => {
                        setDone(forced ? 'forced' : 'voluntary');
                    },
                    onError: (error: unknown) => {
                        const failure = toFailure(error);
                        const leftover = applyServerFailure(failure, form.setError, [
                            ...KNOWN_FIELDS,
                        ]);
                        setFormError(leftover ?? describeFailure(failure));
                    },
                },
            );
        },
        [describeFailure, forced, form, setFormError, update],
    );

    const eye = {
        revealed,
        onToggleReveal: () => {
            setRevealed((value) => !value);
        },
        showLabel: t('auth:changePassword.showPassword'),
        hideLabel: t('auth:changePassword.hidePassword'),
    };

    if (done !== null) {
        return (
            <View testID="change-password-screen" className="flex-col items-center gap-3.5">
                <AuthTick />
                <AuthTitle testID="change-password-success-title" centred>
                    {t('auth:changePassword.successTitle')}
                </AuthTitle>
                <View role="status" aria-live="polite">
                    <AuthText centred>{t('auth:changePassword.successBody')}</AuthText>
                </View>
                <View className="mt-2 w-full">
                    <AuthSubmit
                        testID="change-password-continue"
                        label={t('auth:changePassword.continueLabel')}
                        onPress={() => {
                            if (done === 'forced') completeAuth(back.returnTo);
                            else back.finish();
                        }}
                    />
                </View>
            </View>
        );
    }

    return (
        <View testID="change-password-screen" className="flex-col gap-3.5">
            <AuthBadge icon="keyRound" />
            <AuthTitle testID="change-password-title">
                {forced ? t('auth:changePassword.title') : t('auth:changePassword.optionalTitle')}
            </AuthTitle>

            {formError === null ? null : (
                <AuthError testID="change-password-error" message={formError} />
            )}

            <Controller
                control={form.control}
                name="current_password"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="change-password-current"
                        label={
                            forced
                                ? t('auth:changePassword.currentLabel')
                                : t('auth:changePassword.optionalCurrentLabel')
                        }
                        icon="lock"
                        placeholder={t('auth:changePassword.currentPlaceholder')}
                        autoComplete="current-password"
                        secret
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="change-password-new"
                        label={t('auth:changePassword.passwordLabel')}
                        icon="lock"
                        placeholder={t('auth:changePassword.passwordPlaceholder')}
                        autoComplete="new-password"
                        secret
                        {...eye}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="password_confirmation"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="change-password-confirmation"
                        label={t('auth:changePassword.passwordConfirmationLabel')}
                        icon="lock"
                        placeholder={t('auth:changePassword.passwordConfirmationPlaceholder')}
                        autoComplete="new-password"
                        secret
                        {...eye}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <AuthHint>{t('auth:register.passwordHint', { count: PASSWORD_MIN_LENGTH })}</AuthHint>

            <AuthSubmit
                testID="change-password-submit"
                label={t('auth:changePassword.submit')}
                busy={update.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            {forced ? null : (
                <AuthLink
                    testID="change-password-cancel"
                    label={t('common:action.cancel')}
                    onPress={back.leave}
                />
            )}
        </View>
    );
}
