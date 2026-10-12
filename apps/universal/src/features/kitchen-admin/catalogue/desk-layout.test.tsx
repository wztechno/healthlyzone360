import { screen } from '@testing-library/react-native';
import { Button, ContentWidthProvider } from '@healthy360/design-system';
import { Text } from 'react-native';

import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import { CatalogueToolbar } from './catalogue-toolbar.tsx';
import { statCardRows } from './catalogue-stat-cards.tsx';
import { RecordViewPage } from './record-view-page.tsx';

/*
 * The admin on a laptop. A 1920×1080 panel at 150% scaling hands the browser 1280px, and the shell's
 * rail, page panel and padding take a large share of that before a page draws anything — so every
 * page here is laid out against the content column the shell reports, never the window.
 */

let mockWindowWidth = 1280;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: mockWindowWidth, height: 720, scale: 1, fontScale: 1 }),
}));

/** The desk shell with its page panel open: 56 rail + 232 panel, 28px padding a side. */
const PANEL_OPEN = { chrome: 288, padding: 28 };
/** The same shell with the panel shut — what a laptop opens on. */
const PANEL_SHUT = { chrome: 56, padding: 28 };

describe('statCardRows', () => {
    it('keeps the whole set on one row while every card clears its floor', () => {
        expect(statCardRows(4, 1168)).toEqual({ perRow: 4 });
        expect(statCardRows(5, 1168)).toEqual({ perRow: 5 });
    });

    it('balances the rows rather than leaving one card on a line of its own', () => {
        // 680px holds three 200px cards: four go 2 + 2, not 3 + 1.
        expect(statCardRows(4, 680)).toEqual({ perRow: 2 });
        // 920px holds four: the home's five go 3 + 2, not 4 + 1.
        expect(statCardRows(5, 920)).toEqual({ perRow: 3 });
    });

    it('draws one row before there is a width to count against', () => {
        expect(statCardRows(4, 0)).toEqual({ perRow: 4 });
    });
});

describe('CatalogueToolbar', () => {
    it('keeps the actions in their own zone, apart from the filters that wrap', async () => {
        await renderStubScreen(
            <CatalogueToolbar
                testID="toolbar"
                search=""
                onSearchChange={() => undefined}
                searchLabel="Search"
                filters={<Text testID="toolbar-date">From</Text>}
            >
                <Button testID="toolbar-create" label="New" onPress={() => undefined} />
            </CatalogueToolbar>,
        );

        const filters = screen.getByTestId('toolbar-filters');
        const actions = screen.getByTestId('toolbar-actions');
        expect(screen.getByTestId('toolbar-search')).toBeTruthy();
        // The entity's own filter wraps with the search; the primary never does.
        expect(filters).toContainElement(screen.getByTestId('toolbar-date'));
        expect(filters).not.toContainElement(screen.getByTestId('toolbar-create'));
        expect(actions).toContainElement(screen.getByTestId('toolbar-create'));
    });

    it('draws no actions zone for a toolbar that has none', async () => {
        await renderStubScreen(
            <CatalogueToolbar
                testID="toolbar"
                search=""
                onSearchChange={() => undefined}
                searchLabel="Search"
            />,
        );
        expect(screen.queryByTestId('toolbar-actions')).toBeNull();
    });
});

describe('RecordViewPage on a laptop', () => {
    const page = (
        <RecordViewPage
            testID="record"
            title="Tahini paste"
            kind="Ingredient"
            onBack={() => undefined}
            fields={[{ key: 'reference', label: 'Reference', value: 'ING-0142' }]}
            statusLines={['Updated today']}
            primaryAction={{ label: 'Edit', onPress: () => undefined }}
        />
    );

    /** The order the body's columns are in the tree — the order they are read and laid out. */
    function bodyOrder(): string[] {
        const body = screen.getByTestId('record-body');
        const ids = ['record-record-status', 'record-main', 'record-rail'];
        const nodes = ids.map((id) => screen.getByTestId(id));
        const order: string[] = [];
        const walk = (node: typeof body) => {
            const index = nodes.indexOf(node);
            if (index >= 0) order.push(ids[index] ?? '');
            for (const child of node.children) {
                if (typeof child !== 'string') walk(child);
            }
        };
        walk(body);
        return order;
    }

    it('sets the rail beside the record where the page has room, panel shut at 1280', async () => {
        mockWindowWidth = 1280;
        await renderStubScreen(
            <ContentWidthProvider value={PANEL_SHUT}>{page}</ContentWidthProvider>,
        );

        expect(screen.getByTestId('record-body').props.className).toContain('flex-row');
        // The status card is the rail's, after the main column.
        expect(bodyOrder()).toEqual(['record-main', 'record-rail', 'record-record-status']);
    });

    it('stacks a narrow page with the status card — and its action — first', async () => {
        // 1093px: a 1366×768 laptop at 125%, with the page panel open, leaves 749px.
        mockWindowWidth = 1093;
        await renderStubScreen(
            <ContentWidthProvider value={PANEL_OPEN}>{page}</ContentWidthProvider>,
        );

        expect(screen.getByTestId('record-body').props.className).not.toContain('flex-row');
        expect(bodyOrder()).toEqual(['record-record-status', 'record-main', 'record-rail']);
        expect(screen.getByTestId('record-primary')).toBeTruthy();
    });
});
