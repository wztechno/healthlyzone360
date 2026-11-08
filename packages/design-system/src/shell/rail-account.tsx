import { useRef, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { useDismiss } from '../overlays/anchored-surface.ts';

export interface RailAccountProps {
    /** The signed-in person's display name. Its first letter is the avatar. */
    readonly name: string;
    /** The line under the name — "Owner · Main kitchen". Omitted when there is nothing to say. */
    readonly detail?: string | undefined;
    /** The avatar's accessible name — "Hala, account". */
    readonly label: string;
    /** The card's accessible name — "Account". */
    readonly menuLabel: string;
    readonly signOutLabel: string;
    readonly signingOut?: boolean | undefined;
    readonly onSignOut: () => void;
    readonly testID?: string | undefined;
}

/**
 * The account avatar at the foot of the workspace's module rail, and the small card it opens beside
 * the rail: the avatar again, the name, the role and place, a rule, and Sign out. Nothing else — the
 * language and the theme stay in the top bar (the user's choice of option B, 2026-11-07).
 *
 * The card hangs from the avatar's own box, to the rail's inline end and level with its foot, so it
 * needs no portal: the rail column is raised above the panel and the page (`z-raised`), and the
 * avatar's wrapper is `z-auto` rather than a stacking context of its own. Escape and a press outside
 * close it.
 */
export function RailAccount({
    name,
    detail,
    label,
    menuLabel,
    signOutLabel,
    signingOut = false,
    onSignOut,
    testID = 'account',
}: RailAccountProps) {
    const [open, setOpen] = useState(false);
    const [signOutHovered, setSignOutHovered] = useState(false);
    const [avatarHovered, setAvatarHovered] = useState(false);
    const lit = open || avatarHovered;
    const containerRef = useRef<View | null>(null);
    useDismiss({
        open,
        onClose: () => {
            setOpen(false);
        },
        containerRef,
    });
    const initial = name.trim().slice(0, 1).toLocaleUpperCase();

    return (
        <View ref={containerRef} className="z-auto mt-1.5">
            <Pressable
                testID={`${testID}-avatar`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={label}
                aria-haspopup="menu"
                aria-expanded={open}
                focusable
                onPress={() => {
                    setOpen((current) => !current);
                }}
                onHoverIn={() => {
                    setAvatarHovered(true);
                }}
                onHoverOut={() => {
                    setAvatarHovered(false);
                }}
                className={cx(
                    'h-10 w-10 items-center justify-center rounded-full',
                    lit ? 'bg-surface-sidebar-active' : 'bg-content-on-sidebar/20',
                )}
            >
                <RNText
                    className={cx(
                        'font-display text-sm font-bold',
                        lit ? 'text-content-on-sidebar-active' : 'text-content-on-sidebar',
                    )}
                >
                    {initial}
                </RNText>
            </Pressable>

            {open ? (
                <View
                    testID={`${testID}-menu`}
                    role="menu"
                    aria-label={menuLabel}
                    // From the avatar's end edge across the rest of the rail (16px) and the 12px
                    // gutter, its foot level with the rail's: the frame boards' 96px / 12px.
                    className="absolute start-full ms-[28px] w-[288px] rounded-xl border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-3"
                    style={{ bottom: -14 }}
                >
                    <View className="flex-row items-center gap-3 px-2.5 pb-3 pt-2.5">
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-brand-subtle">
                            <RNText className="font-display text-base font-bold text-content-on-brand-subtle">
                                {initial}
                            </RNText>
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText
                                testID={`${testID}-name`}
                                numberOfLines={1}
                                className="text-base font-bold text-content-primary text-start"
                            >
                                {name}
                            </RNText>
                            {detail === undefined || detail === '' ? null : (
                                <RNText
                                    testID={`${testID}-detail`}
                                    numberOfLines={1}
                                    className="mt-0.5 text-sm text-content-secondary text-start"
                                >
                                    {detail}
                                </RNText>
                            )}
                        </View>
                    </View>
                    <View className="mx-1.5 my-1 h-px bg-stroke-subtle" />
                    <Pressable
                        testID="sign-out"
                        role="menuitem"
                        accessibilityRole="menuitem"
                        accessibilityLabel={signOutLabel}
                        accessibilityState={{ disabled: signingOut }}
                        disabled={signingOut}
                        focusable
                        onHoverIn={() => {
                            setSignOutHovered(true);
                        }}
                        onHoverOut={() => {
                            setSignOutHovered(false);
                        }}
                        onPress={onSignOut}
                        className={cx(
                            'min-h-[44px] flex-row items-center gap-2.5 rounded-lg px-2.5',
                            signOutHovered ? 'bg-surface-sunken' : 'bg-transparent',
                            signingOut ? 'opacity-60' : null,
                        )}
                    >
                        <Icon name="signOut" className="text-danger-strong" />
                        <RNText className="text-sm font-semibold text-danger-strong text-start">
                            {signOutLabel}
                        </RNText>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}
