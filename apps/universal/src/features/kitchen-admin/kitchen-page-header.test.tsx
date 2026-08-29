import { Badge, Button } from '@healthy360/design-system';
import { screen } from '@testing-library/react-native';

import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { KitchenPageHeader } from './kitchen-page-header.tsx';

describe('KitchenPageHeader', () => {
    it('emits the title and subtitle under the ids a caller overrides', async () => {
        await renderStubScreen(
            <KitchenPageHeader
                testID="header"
                title="Stock"
                subtitle="On hand per branch"
                titleTestID="kitchen-stock-title"
                subtitleTestID="kitchen-stock-subtitle"
            />,
        );

        expect(screen.getByTestId('kitchen-stock-title')).toHaveTextContent('Stock');
        expect(screen.getByTestId('kitchen-stock-subtitle')).toHaveTextContent(
            'On hand per branch',
        );
        // No chip, no actions: the slots leave nothing behind.
        expect(screen.queryByTestId('header-actions-slot')).toBeNull();
    });

    it('places the status chip beside the title and the actions on the title row', async () => {
        await renderStubScreen(
            <KitchenPageHeader
                testID="header"
                title="Meals"
                statusChip={<Badge testID="header-chip" tone="warning" label="Draft" />}
                actions={<Button testID="header-create" label="New meal" />}
            />,
        );

        expect(screen.getByTestId('header-title')).toHaveTextContent('Meals');
        expect(screen.getByTestId('header-chip')).toBeTruthy();
        expect(screen.getByTestId('header-actions-slot')).toBeTruthy();
        expect(screen.getByTestId('header-create')).toBeTruthy();
    });
});
