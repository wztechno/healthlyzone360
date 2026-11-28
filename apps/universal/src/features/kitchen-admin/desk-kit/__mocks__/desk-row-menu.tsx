import type { MenuItem } from '@healthy360/design-system';
import { Pressable, Text, View } from 'react-native';

/**
 * The desk `⋯` drawn flat, for screen tests: see `jest.setup.js`. The trigger is kept (inert), so a
 * suite that presses it before an action still finds both.
 */
export function DeskRowMenu({
    actions,
    label,
    testID,
}: {
    readonly actions: readonly MenuItem[];
    readonly label: string;
    readonly testID: string;
}) {
    if (actions.length === 0) return null;
    return (
        <View>
            <Pressable testID={`${testID}-trigger`} accessibilityLabel={label} />
            {actions.map((action) => (
                <Pressable
                    key={action.key}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    accessibilityState={{ disabled: action.disabled === true }}
                    disabled={action.disabled === true}
                    onPress={action.onSelect}
                    testID={action.testID}
                >
                    <Text>{action.label}</Text>
                </Pressable>
            ))}
        </View>
    );
}
