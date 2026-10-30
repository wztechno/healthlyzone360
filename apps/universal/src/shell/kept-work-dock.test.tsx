import { act, fireEvent, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { keepWork, readKeptWork } from '../navigation/kept-work.ts';
import { clearAllSessionDrafts } from '../navigation/session-draft.ts';
import type { ExpoRouterMock } from '../testing/expo-router-mock.ts';
import { renderStubScreen } from '../testing/stub-screen.tsx';
import { KeptWorkButton, KeptWorkDock } from './kept-work-dock.tsx';

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/kitchen/stock',
    }),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

function keepRecipe(key: string, subject: string | null): void {
    keepWork({
        kind: 'recipe',
        subject,
        href: `/kitchen/recipes/${key}`,
        draft: { namespace: 'recipeEditor', key },
    });
}

async function renderChrome() {
    return renderStubScreen(
        <View>
            <KeptWorkButton />
            <KeptWorkDock />
        </View>,
    );
}

beforeEach(() => {
    routerMock.__reset();
});

afterEach(() => {
    clearAllSessionDrafts();
});

describe('the kept work card', () => {
    it('draws nothing while nothing is kept', async () => {
        await renderChrome();
        expect(screen.queryByTestId('kept-work-dock')).toBeNull();
        expect(screen.queryByTestId('process-resume')).toBeNull();
    });

    it('lists every kept editor, a new one by its kind, and leads back to it', async () => {
        await renderChrome();
        await act(async () => {
            keepRecipe('recipe-1', 'Bbq Sauce Dip');
            keepWork({
                kind: 'ingredient',
                subject: null,
                href: '/kitchen/ingredients/new',
                draft: { namespace: 'ingredientEditor', key: 'new:/kitchen/ingredients' },
            });
        });

        expect(screen.getByTestId('kept-work-dock')).toBeTruthy();
        expect(screen.getAllByTestId('kept-work-dock-row')).toHaveLength(2);
        expect(screen.getByText('New ingredient')).toBeTruthy();
        expect(screen.getByText('Bbq Sauce Dip')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getAllByTestId('kept-work-dock-continue')[0]!);
        });
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/ingredients/new');
    });

    it('tucks into the top bar when minimised, and opens again for the next thing kept', async () => {
        await renderChrome();
        await act(async () => {
            keepRecipe('recipe-1', 'Bbq Sauce Dip');
        });
        expect(screen.queryByTestId('process-resume')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kept-work-dock-minimise'));
        });
        expect(screen.queryByTestId('kept-work-dock')).toBeNull();
        expect(screen.getByTestId('process-resume-count')).toHaveTextContent('1');

        await act(async () => {
            fireEvent.press(screen.getByTestId('process-resume'));
        });
        expect(screen.getAllByTestId('kept-work-panel-row')).toHaveLength(1);

        await act(async () => {
            keepRecipe('recipe-2', 'Lentil Soup');
        });
        expect(screen.getAllByTestId('kept-work-dock-row')).toHaveLength(2);
    });

    it('throws a row away only once the reader confirms', async () => {
        await renderChrome();
        await act(async () => {
            keepRecipe('recipe-1', 'Bbq Sauce Dip');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kept-work-dock-discard'));
        });
        expect(readKeptWork()).toHaveLength(1);
        await act(async () => {
            fireEvent.press(screen.getByTestId('kept-work-dock-discard-confirm'));
        });
        expect(readKeptWork()).toEqual([]);
        expect(screen.queryByTestId('kept-work-dock')).toBeNull();
    });
});
