import { useBreakpoint } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

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

    return (
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
                        onPress={() => {
                            router.dismissTo('/discover' as never);
                        }}
                    />
                    <ThemeToggle />
                </View>
            </View>
        </View>
    );
}
