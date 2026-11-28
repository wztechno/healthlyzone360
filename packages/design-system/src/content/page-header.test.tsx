import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PageHeader } from './page-header.tsx';

describe('PageHeader', () => {
    it('draws the title alone when that is all it is given', async () => {
        await render(<PageHeader testID="header" title="Storefront" />);

        expect(screen.getByTestId('header-title')).toHaveTextContent('Storefront');
        expect(screen.queryByTestId('header-actions')).toBeNull();
        expect(screen.queryByTestId('header-info')).toBeNull();
    });

    it('puts the status beside the title, the purpose behind an (i), and the actions at the end', async () => {
        await render(
            <PageHeader
                testID="header"
                title="New recipe"
                titleTestID="recipe-title"
                titleAside={<Text testID="header-status">Draft</Text>}
                info="What customers read on your page."
                actions={<Text testID="header-save">Save draft</Text>}
            />,
        );

        expect(screen.getByTestId('recipe-title')).toHaveTextContent('New recipe');
        expect(screen.getByTestId('header-status')).toBeTruthy();
        expect(screen.getByTestId('header-info')).toBeTruthy();
        expect(screen.getByTestId('header-actions')).toBeTruthy();
        expect(screen.getByTestId('header-save')).toBeTruthy();
    });
});
