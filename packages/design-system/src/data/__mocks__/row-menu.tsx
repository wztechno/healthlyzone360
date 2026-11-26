import type { MenuItem } from '../../overlays/menu.tsx';
import { Pressable, Text, View } from 'react-native';

/**
 * The row's `⋯` drawn flat, for screen tests: see `jest.setup.js`. The trigger is kept (inert), so a
 * suite that presses it before an action still finds both.
 */
/** The action track's width, as the real part has it. */
export const ROW_ACTIONS_WIDTH = 72;

export function RowMenu({
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
            {/* Inert, but it takes its own press: the real `⋯` never lets one reach the row. */}
            <Pressable
                testID={`${testID}-trigger`}
                accessibilityLabel={label}
                onPress={() => undefined}
            />
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
