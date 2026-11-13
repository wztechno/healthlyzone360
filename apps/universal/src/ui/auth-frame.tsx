import { Icon, ToastLookScope, useBreakpoint } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, ScrollView, View } from 'react-native';

import { ThemeToggle } from '../shell/theme-toggle.tsx';
import { AuthStage } from './auth-stage';
import { BackPill } from './back-pill.tsx';

/**
 * The accepted boards' sign-in frame: the stage on the start side from `lg` (`auth-stage`), and
 * beside it the form — "Back to the shop" and the theme toggle along its top, the page's own pane
 * centred under them at the boards' 420px.
 *
 * It replaces the app shell's `auth` variant one page at a time: `app/(auth)/_layout.tsx` draws this
 * for the pages already rebuilt as the boards, and the shell for the rest — the staff branch and
 * organisation pickers among them, which are not shop pages and keep theirs.
 *
 * The form side is its own scroll port (`auth-shell-content`), as every shell's is: the document
 * never scrolls.
 */
export function AuthFrame({ children }: { readonly children: ReactNode }) {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const toShop = () => {
        router.dismissTo('/discover' as never);
    };

    /*
     * The phone boards: a canopy panel at the top — "Back to the shop", the theme toggle, the brand
     * — and the form in a sheet rising over its foot, rather than a bare page.
     */
    if (!atLeast('md')) {
        return (
            <ToastLookScope look="card">
                <View testID="auth-frame" className="flex-1 bg-surface-canopy">
                    <ScrollView
                        testID="auth-shell-content"
                        className="flex-1"
                        contentContainerClassName="flex-grow"
                    >
                        <View className="relative h-[200px] overflow-hidden px-4 pt-3">
                            <View
                                aria-hidden
                                pointerEvents="none"
                                className="absolute -end-24 -top-28 h-[320px] w-[320px] rounded-full bg-stage-green opacity-15"
                            />
                            <View className="flex-row items-center justify-between">
                                <BackPill
                                    testID="auth-frame-shop"
                                    label={t('auth:frame.backToShop')}
                                    onPress={toShop}
                                />
                                <ThemeToggle onCanopy />
                            </View>
                            <View className="mt-5 flex-row items-center gap-2.5">
                                <View className="h-10 w-10 items-center justify-center rounded-full bg-stage-green">
                                    <Icon name="leaf" className="text-surface-canopy" />
                                </View>
                                <RNText className="font-display text-xl font-bold tracking-display text-content-on-canopy">
                                    {t('marketplace:brand.name')}
                                </RNText>
                            </View>
                        </View>
                        <View
                            role="main"
                            className="-mt-6 flex-grow rounded-t-[28px] bg-surface-base px-4 pb-10 pt-5"
                        >
                            {children}
                        </View>
                    </ScrollView>
                </View>
            </ToastLookScope>
        );
    }

    return (
        <ToastLookScope look="card">
            <View testID="auth-frame" className="flex-1 flex-row bg-surface-base">
                {atLeast('lg') ? <AuthStage /> : null}
                <View className="relative min-w-0 flex-1">
                    <ScrollView
                        testID="auth-shell-content"
                        className="flex-1"
                        contentContainerClassName="flex-grow items-center justify-center px-4 pb-10 pt-24 sm:px-10"
                    >
                        <View role="main" className="w-full max-w-[420px]">
                            {children}
                        </View>
                    </ScrollView>
                    <View className="absolute end-4 start-4 top-6 flex-row items-center justify-between sm:end-8 sm:start-8">
                        <BackPill
                            testID="auth-frame-shop"
                            label={t('auth:frame.backToShop')}
                            onPress={toShop}
                        />
                        <ThemeToggle />
                    </View>
                </View>
            </View>
        </ToastLookScope>
    );
}
