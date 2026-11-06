import { HideShellTopbar, Icon } from '@healthy360/design-system';
import { Text as RNText, View, Pressable } from 'react-native';

/**
 * A shop page's own top on a phone, in place of the shop bar (the Basket and Checkout phone
 * boards): the same 56px pill, a round Back, the page's name as its heading, and an optional count
 * beside it. Mounting it takes the shop bar away; unmounting puts it back.
 */
export function ShopPhoneTopBar({
    backTestID,
    backLabel,
    onBack,
    titleTestID,
    title,
    count,
    heading = true,
}: {
    readonly backTestID: string;
    readonly backLabel: string;
    readonly onBack: () => void;
    readonly titleTestID: string;
    readonly title: string;
    readonly count?: string | undefined;
    /** `false` where the page below carries its own level-1 heading. */
    readonly heading?: boolean;
}) {
    return (
        <>
            <HideShellTopbar />
            <View className="h-14 flex-row items-center gap-2.5 rounded-full border border-stroke-subtle bg-surface-raised pe-4 ps-1.5 shadow-elevation-3">
                <Pressable
                    testID={backTestID}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={backLabel}
                    onPress={onBack}
                    className="h-11 w-11 items-center justify-center rounded-full bg-surface-base"
                >
                    <Icon name="chevronBackward" className="text-content-primary" />
                </Pressable>
                <RNText
                    testID={titleTestID}
                    {...(heading ? { role: 'heading' as const, 'aria-level': 1 } : {})}
                    numberOfLines={1}
                    className="min-w-0 shrink font-display text-xl font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
                {count === undefined ? null : (
                    <View className="h-[26px] justify-center rounded-full bg-surface-brand-subtle px-2.5">
                        <RNText className="text-xs font-semibold text-content-on-brand-subtle">
                            {count}
                        </RNText>
                    </View>
                )}
            </View>
        </>
    );
}
