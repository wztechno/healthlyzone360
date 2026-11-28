import { Button } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { View } from 'react-native';

/** The row's actions drawn flat, for screen tests: see `jest.setup.js`. */
export const ROW_ACTIONS_WIDTH = 72;

export function RowActionsMenu({ actions }: { readonly actions: readonly MenuItem[] }) {
    return (
        <View>
            {actions.map((action) => (
                <Button
                    key={action.key}
                    label={action.label}
                    {...(action.disabled === undefined ? {} : { disabled: action.disabled })}
                    onPress={action.onSelect}
                    testID={action.testID}
                />
            ))}
        </View>
    );
}
