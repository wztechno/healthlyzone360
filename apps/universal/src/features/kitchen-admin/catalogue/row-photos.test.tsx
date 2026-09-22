import { createI18n } from '@healthy360/i18n';
import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Dimensions, Text } from 'react-native';

import { CatalogueList } from './catalogue-list.tsx';
import type { CatalogueColumn } from './catalogue-column-spec.ts';
import { RecordPhoto } from './record-photo.tsx';

/**
 * Row and record photographs across every Catalogue list, tested once here rather than per entity.
 *
 * The screens each assert their own thumbnail id; what this file pins is the mechanism under them:
 * a spec names the picture once with `thumbnail`, and `CatalogueList` draws it in **both** of its
 * shapes. That second shape is the one that was missing — every list that had a photograph drew it
 * only in the wide table, because the narrow row reads a column's plain `value` and never calls its
 * renderer — so both widths are rendered here on purpose.
 */

interface Row {
    readonly id: string;
    readonly name: string;
}

const ROWS: readonly Row[] = [
    { id: 'black-pepper', name: 'Black Pepper' },
    { id: 'no-photo', name: 'Unphotographed' },
];

function spec(withThumbnail: boolean): readonly CatalogueColumn<Row>[] {
    return [
        {
            key: 'name',
            label: 'Item',
            width: 200,
            priority: 100,
            role: 'title',
            value: (row) => row.name,
            // The spec's own title renderer, which the photograph must wrap and not replace.
            render: (row) => <Text testID={`title-${row.id}`}>{row.name}</Text>,
            ...(withThumbnail ? { thumbnail: (row: Row) => `ingredient-${row.id}` } : {}),
        },
    ];
}

/** Row photographs are decorative, so they are found only with hidden elements included. */
const HIDDEN = { includeHiddenElements: true } as const;

function renderList(withThumbnail: boolean) {
    return render(
        <CatalogueList
            testID="list"
            label="Ingredients"
            columns={spec(withThumbnail)}
            rows={ROWS}
            rowKey={(row) => row.id}
            rowActionsLabel="Row actions"
        />,
    );
}

/** React Native's Jest window is 750px, just under `md` — the narrow row is the default here. */
function atDeskWidth() {
    const window = Dimensions.get('window');
    const screenSize = Dimensions.get('screen');

    beforeAll(() => {
        Dimensions.set({
            window: { ...window, width: 1440, height: 900 },
            screen: { ...screenSize, width: 1440, height: 900 },
        });
    });

    afterAll(() => {
        Dimensions.set({ window, screen: screenSize });
    });
}

describe('row photographs — the narrow row', () => {
    it('draws the photograph on every row, including one with no bundled file', async () => {
        await renderList(true);

        // One with a photograph, one without: the second draws the generated pattern in the same
        // frame, so the row keeps its shape rather than collapsing.
        expect(screen.getByTestId('list-row-black-pepper-image', HIDDEN)).toBeTruthy();
        expect(screen.getByTestId('list-row-no-photo-image', HIDDEN)).toBeTruthy();
    });

    it('hides both from assistive technology, photograph or pattern', async () => {
        await renderList(true);

        // The title beside it already names the row; announcing the picture too would say the
        // name twice (WCAG H67). The pattern case is the one that used to be announced.
        expect(screen.queryByTestId('list-row-black-pepper-image')).toBeNull();
        expect(screen.queryByTestId('list-row-no-photo-image')).toBeNull();
    });

    it('draws nothing extra for a spec that names no photograph', async () => {
        await renderList(false);

        expect(screen.queryByTestId('list-row-black-pepper-image', HIDDEN)).toBeNull();
    });
});

describe('row photographs — the wide table', () => {
    atDeskWidth();

    it('draws the photograph inside the title cell and keeps the spec’s own title', async () => {
        await renderList(true);

        expect(screen.getByTestId('list-row-black-pepper-image', HIDDEN)).toBeTruthy();
        expect(screen.getByTestId('list-row-no-photo-image', HIDDEN)).toBeTruthy();
        // Wrapped, not replaced: the spec still owns how its title reads.
        expect(screen.getByTestId('title-black-pepper')).toBeTruthy();
    });

    it('leaves the title cell exactly as the spec drew it when there is no thumbnail', async () => {
        await renderList(false);

        expect(screen.queryByTestId('list-row-black-pepper-image', HIDDEN)).toBeNull();
        expect(screen.getByTestId('title-black-pepper')).toBeTruthy();
    });
});

describe('RecordPhoto', () => {
    const i18n = createI18n({ locale: 'en' });

    async function renderPhoto(assetId: string, shape: 'square' | 'wide') {
        return render(
            <I18nextProvider i18n={i18n}>
                <RecordPhoto assetId={assetId} label="Record" shape={shape} testID="photo" />
            </I18nextProvider>,
        );
    }

    it('renders a card with the photograph when the record has one', async () => {
        await renderPhoto('ingredient-black-pepper', 'square');

        expect(screen.getByTestId('photo')).toBeTruthy();
        expect(screen.getByTestId('photo-image')).toBeTruthy();
    });

    it('renders a wide dish photograph from its detail file', async () => {
        await renderPhoto('recipe-herbed-chicken-freekeh', 'wide');

        expect(screen.getByTestId('photo-image')).toBeTruthy();
    });

    it('renders nothing at all for a record with no photograph', async () => {
        // A large generated pattern in the rail would push the record's status down for no
        // information, so an unmapped record gets no card rather than a placeholder one.
        await renderPhoto('ingredient-not-sourced', 'square');

        expect(screen.queryByTestId('photo')).toBeNull();
    });
});
