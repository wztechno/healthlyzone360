import { RowMenu } from './row-menu.tsx';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

describe('a table row’s actions', () => {
    const actions = (onView: () => void) => [
        { key: 'view', label: 'View', testID: 'row-view', onSelect: onView },
        {
            key: 'archive',
            label: 'Archive',
            testID: 'row-archive',
            disabled: true,
            onSelect: jest.fn(),
        },
    ];

    it('keeps them behind three dots until the dots are pressed', async () => {
        const onView = jest.fn();
        await render(<RowMenu actions={actions(onView)} label="Row actions" testID="row" />);

        expect(screen.queryByTestId('row-view')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('row-trigger'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('row-view'));
        });

        expect(onView).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('row-view')).toBeNull();
    });

    it('draws nothing for a row with nothing to do', async () => {
        await render(<RowMenu actions={[]} label="Row actions" testID="row" />);

        expect(screen.queryByTestId('row-trigger')).toBeNull();
    });
});
