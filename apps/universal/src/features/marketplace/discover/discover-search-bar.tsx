import { Icon, useMotion } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, Text as RNText, TextInput, View } from 'react-native';

import { withQuery } from '../../../navigation/return-to.ts';
import { QUERY_PARAM } from '../filter-bar.tsx';
import { DeliverToMenu } from './deliver-to-menu.tsx';

/** The menu the search narrows. */
const MENU_PATH = '/meals';
const HINT_KEYS = [
    'marketplace:discover.hint1',
    'marketplace:discover.hint2',
    'marketplace:discover.hint3',
    'marketplace:discover.hint4',
    'marketplace:discover.hint5',
] as const;
/** One line of the rolling hint, and how long each word stays. */
const HINT_LINE = 24;
const HINT_STEP_MS = 2400;

/**
 * The opening of Discover, as the accepted design draws it: one rounded bar — where the food goes,
 * a search field whose hint rolls through a few things to look for, and a round go button.
 *
 * **Deliver to** opens the saved addresses (`deliver-to-menu.tsx`).
 *
 * The search opens the menu on the term (`?q=`), the same parameter the menu's own field writes.
 */
export function DiscoverSearchBar({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    const router = useRouter();

    const [term, setTerm] = useState('');
    const [focused, setFocused] = useState(false);

    const submit = () => {
        const value = term.trim();
        router.push(
            (value === '' ? MENU_PATH : withQuery(MENU_PATH, { [QUERY_PARAM]: value })) as never,
        );
    };

    // `z-auto` here and on the bar lets the address dropdown sit above the rest of the page.
    return (
        <View testID={testID} className="z-auto items-center pb-7 pt-8">
            <View
                className={
                    focused
                        ? 'z-auto h-[60px] w-full max-w-[760px] flex-row items-center gap-1.5 rounded-full border border-surface-brand bg-surface-raised p-1.5 shadow-elevation-2'
                        : 'z-auto h-[60px] w-full max-w-[760px] flex-row items-center gap-1.5 rounded-full border border-stroke bg-surface-raised p-1.5 shadow-elevation-2'
                }
            >
                <DeliverToMenu testID={testID} />

                <View aria-hidden className="h-7 w-px bg-stroke" />

                <View className="min-w-0 flex-1 flex-row items-center gap-2.5 ps-2.5">
                    <Icon name="search" className="text-content-secondary" />
                    <View className="relative h-6 min-w-0 flex-1">
                        <TextInput
                            testID={`${testID}-field`}
                            accessibilityLabel={t('marketplace:nav.searchLabel')}
                            value={term}
                            onChangeText={setTerm}
                            onFocus={() => {
                                setFocused(true);
                            }}
                            onBlur={() => {
                                setFocused(false);
                            }}
                            onSubmitEditing={submit}
                            returnKeyType="search"
                            className="absolute inset-0 p-0 text-base text-content-primary outline-none"
                        />
                        {term === '' ? <RollingHint /> : null}
                    </View>
                </View>

                <Pressable
                    testID={`${testID}-go`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('marketplace:nav.searchLabel')}
                    onPress={submit}
                    className="h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-brand transition duration-normal ease-standard active:scale-95"
                >
                    <Icon name="search" className="text-content-on-brand" />
                </Pressable>
            </View>
        </View>
    );
}

/**
 * "Search for tawouk", then "a burger", "fresh dips"… — one word at a time, each sliding up into
 * place every 2.4s while the field is empty. Under reduced motion it stays on the first word.
 */
function RollingHint() {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const [index, setIndex] = useState(0);
    const [offset] = useState(() => new Animated.Value(0));

    useEffect(() => {
        if (!enabled) return;
        const timer = setInterval(() => {
            setIndex((current) => (current + 1) % HINT_KEYS.length);
        }, HINT_STEP_MS);
        return () => {
            clearInterval(timer);
        };
    }, [enabled]);

    useEffect(() => {
        const animation = Animated.timing(offset, {
            toValue: -index * HINT_LINE,
            duration: enabled ? 450 : 0,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, index, offset]);

    return (
        <View
            aria-hidden
            pointerEvents="none"
            className="absolute inset-0 flex-row items-center gap-1.5"
        >
            <RNText className="text-base text-content-secondary">
                {t('marketplace:discover.searchFor')}
            </RNText>
            <View className="h-6 overflow-hidden">
                <Animated.View style={{ transform: [{ translateY: offset }] }}>
                    {HINT_KEYS.map((key) => (
                        <RNText
                            key={key}
                            className="h-6 text-base font-semibold leading-6 text-content-primary"
                        >
                            {t(key)}
                        </RNText>
                    ))}
                </Animated.View>
            </View>
        </View>
    );
}
