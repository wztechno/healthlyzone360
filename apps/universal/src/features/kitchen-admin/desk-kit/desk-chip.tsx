import type { BadgeTone } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

/**
 * `.ac` — the desk's status chip: a full pill, 22px, 11px semibold (Orders canvas, 2026-11-10).
 *
 * ```
 * (To confirm) (Confirmed) (Delivered) (Cancelled) (Late)  (Allergy)  ( 3 to confirm )
 *   warning       info       success     neutral    danger  warning      size="lg"
 * ```
 *
 * The tones are `Badge`'s, so a status that already names its tone (`kitchenOrderStatusTone`) moves
 * over unchanged. `sm` is the calendar cell's 20px; `lg` the day panel's and pop-up's 30px.
 */

export type DeskChipSize = 'sm' | 'md' | 'lg';

const GROUND: Readonly<Record<BadgeTone, string>> = {
    warning: 'bg-warning-subtle',
    info: 'bg-info-subtle',
    success: 'bg-surface-brand-subtle',
    brand: 'bg-surface-brand-subtle',
    neutral: 'bg-surface-sunken',
    danger: 'bg-danger-subtle',
};

const INK: Readonly<Record<BadgeTone, string>> = {
    warning: 'text-warning-on-subtle',
    info: 'text-info-on-subtle',
    success: 'text-content-on-brand-subtle',
    brand: 'text-content-on-brand-subtle',
    neutral: 'text-content-secondary',
    danger: 'text-danger-on-subtle',
};

const SIZE: Readonly<Record<DeskChipSize, { readonly box: string; readonly text: string }>> = {
    sm: { box: 'h-5 px-1.5', text: 'text-role-caption font-semibold' },
    md: { box: 'h-[22px] px-2', text: 'text-role-caption font-semibold' },
    lg: { box: 'h-[30px] px-3', text: 'text-role-strong' },
};

export function DeskChip({
    label,
    tone,
    size = 'md',
    testID,
}: {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly size?: DeskChipSize | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={`flex-row items-center rounded-full ${GROUND[tone]} ${SIZE[size].box}`}
        >
            <RNText numberOfLines={1} className={`${SIZE[size].text} ${INK[tone]}`}>
                {label}
            </RNText>
        </View>
    );
}
