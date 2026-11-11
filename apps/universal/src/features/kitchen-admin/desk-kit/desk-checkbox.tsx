import { Icon } from '@healthy360/design-system';
import { Pressable, View } from 'react-native';

/**
 * The desk's tick box — `ChoiceRow`'s check mark on its own, for a table: a row's "order this" and
 * the header's "order all" (Prepare a supply order, 2026-11-11).
 *
 * ```
 * [✓]  ticked — brand fill, white check        [–]  some ticked (the header only)        [ ]  not
 * ```
 *
 * A 20px mark inside a 32px target. `mixed` is the header's third state: pressing it ticks the
 * rest, so a half-ticked list is finished in one press rather than cleared.
 */
export function DeskCheckbox({
    checked,
    mixed = false,
    label,
    onChange,
    disabled = false,
    testID,
}: {
    readonly checked: boolean;
    /** Some but not all — drawn as a dash; a press ticks them all. */
    readonly mixed?: boolean | undefined;
    /** Translated — the box's accessible name ("Order Tahini"). */
    readonly label: string;
    readonly onChange: (next: boolean) => void;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    const on = checked || mixed;
    return (
        <Pressable
            testID={testID}
            role="checkbox"
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: mixed ? 'mixed' : checked, disabled }}
            aria-checked={mixed ? 'mixed' : checked}
            disabled={disabled}
            onPress={() => {
                onChange(mixed ? true : !checked);
            }}
            className={`h-8 w-8 items-center justify-center rounded-lg ${
                disabled ? 'opacity-50' : 'hover:bg-surface-sunken'
            }`}
        >
            <View
                aria-hidden
                className={`h-5 w-5 items-center justify-center rounded-md border-[1.5px] ${
                    on ? 'border-surface-brand bg-surface-brand' : 'border-stroke bg-surface-raised'
                }`}
            >
                {checked && !mixed ? (
                    <Icon name="check" size="sm" className="text-content-on-brand" />
                ) : mixed ? (
                    <Icon name="minus" size="sm" className="text-content-on-brand" />
                ) : null}
            </View>
        </Pressable>
    );
}
