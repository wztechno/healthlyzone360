import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { renderWithI18n } from '../testing/render.tsx';
import { StatusSteps } from './status-steps.tsx';

describe('StatusSteps', () => {
    it('names each step with its date or the dash, and marks the current one', async () => {
        await renderWithI18n(
            <StatusSteps
                testID="track"
                label="Where the order is"
                noValue="—"
                steps={[
                    {
                        key: 'placed',
                        label: 'Placed',
                        at: 'Nov 26, 10:41',
                        state: 'done',
                        testID: 'track-placed',
                    },
                    {
                        key: 'ready',
                        label: 'Ready',
                        at: null,
                        state: 'current',
                        testID: 'track-ready',
                    },
                ]}
                trailing={<Text testID="track-next">Mark ready</Text>}
            />,
        );
        expect(screen.getByTestId('track-placed')).toHaveTextContent('PlacedNov 26, 10:41');
        expect(screen.getByTestId('track-ready')).toHaveTextContent('Ready—');
        expect(screen.getByTestId('track-ready').props['aria-current']).toBe('step');
        expect(screen.getByTestId('track-next')).toBeTruthy();
    });
});
