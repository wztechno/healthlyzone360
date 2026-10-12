import { Skeleton, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

/**
 * The one KPI tile for every kitchen surface — the hub, analytics, the ops boards and the reports
 * each carried a near-identical private copy; this is the merge, in the report frame's order:
 * label, value, meaning.
 *
 * The value and the hint are React Native `Text`, not the design-system one, because both state
 * their own face and colour — the documented className-ordering trap in
 * `packages/design-system/src/primitives/text.tsx`.
 */
export interface KpiTileProps {
    readonly testID: string;
    readonly label: string;
    /**
     * Already formatted by the caller (numbers localised, units applied). `null` renders an em
     * dash — the honest "could not be read", never a zero.
     */
    readonly value: string | null;
    /** Query still in flight: a skeleton where the value goes. */
    readonly pending?: boolean | undefined;
    /** One-line meaning under the value. */
    readonly hint?: string | undefined;
    /** Trend badge slot, under the value. */
    readonly trend?: ReactNode | undefined;
    /** Caption under an em-dash value explaining the absence. */
    readonly nullCaption?: string | undefined;
    /** Value face: `md` the 25px display step, `lg` the 30px title step. */
    readonly size?: 'md' | 'lg' | undefined;
}

export function KpiTile({
    testID,
    label,
    value,
    pending = false,
    hint,
    trend,
    nullCaption,
    size = 'md',
}: KpiTileProps) {
    return (
        <View
            testID={testID}
            className="min-h-[96px] min-w-[140px] flex-1 basis-[140px] rounded-panel border border-stroke-subtle bg-surface-raised p-[18px] shadow-elevation-1"
        >
            <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                {label}
            </RNText>
            {pending ? (
                <View className="mt-1">
                    <Skeleton
                        testID={`${testID}-loading`}
                        heightClassName="h-8"
                        widthClassName="w-1/2"
                    />
                </View>
            ) : (
                <RNText
                    testID={`${testID}-value`}
                    className={
                        size === 'lg'
                            ? 'mt-1 font-display tabular-nums text-role-title text-content-primary text-start'
                            : 'mt-1 font-display tabular-nums text-role-display text-content-primary text-start'
                    }
                >
                    {value ?? '—'}
                </RNText>
            )}
            {trend === undefined ? null : (
                <View className="mt-2 flex-row items-center">{trend}</View>
            )}
            {hint === undefined ? null : (
                // The mood board's KPI footer: the meaning as a small pill.
                <View className="mt-auto flex-row pt-2.5">
                    <View className="rounded-full bg-surface-brand-subtle px-2.5 py-1">
                        <RNText
                            testID={`${testID}-hint`}
                            numberOfLines={1}
                            className="text-role-micro text-content-on-brand-subtle text-start"
                        >
                            {hint}
                        </RNText>
                    </View>
                </View>
            )}
            {!pending && value === null && nullCaption !== undefined ? (
                <Text tone="secondary" variant="caption" className="mt-1">
                    {nullCaption}
                </Text>
            ) : null}
        </View>
    );
}
