import type { ImportReport } from '@healthy360/api-client/contracts';
import { apiFailure, rateLimitFailure, throwFailure } from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { queryKeys } from '../../../data/query-keys.ts';
import type { RepositoryOverrides } from '../../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import { canSaveFiles, saveDownload } from '../save-download.ts';
import { CatalogueTransferActions } from './catalogue-transfer-actions.tsx';
import type {
    CatalogueTransferActionsProps,
    ExportMenuSpec,
} from './catalogue-transfer-actions.tsx';
import { XLSX_MIME, ingredientImportGuide } from './import-guides.ts';

/**
 * The Import / Export pair on its own, against stub repositories.
 *
 * What matters: with no wiring it is still the honest disabled pair; the dialog tells the reader
 * every column verbatim before asking for a file; a bad file is refused before anything is sent;
 * a good one is uploaded and its report read back row by row; and every refusal the server can
 * answer with becomes copy that says what to do next.
 */

// The picker has no native module under Node; stubbed so a test can choose a file.
jest.mock('expo-document-picker', () => ({
    __esModule: true,
    getDocumentAsync: jest.fn(),
}));

// jest-expo runs as iOS, where nothing can be saved; each test says whether this build can.
jest.mock('../save-download.ts');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pickerMock = require('expo-document-picker') as { getDocumentAsync: jest.Mock };
const canSave = jest.mocked(canSaveFiles);
const save = jest.mocked(saveDownload);

type ExcelLoad = NonNullable<ExportMenuSpec['excel']>['load'];

const ID = 'kitchen-ingredients-toolbar';
const GUIDE = ingredientImportGuide(['VEG', 'MEAT']);
const UNITS =
    'g, kg, mg, ml, l, tsp, tbsp, cup, gallon, piece, serving, bunch, can, bag, bottle, pack';

const REPORT: ImportReport = {
    created: 2,
    updated: 1,
    unchanged: 5,
    skipped: 1,
    failed: 1,
    ignoredColumns: ['Colour'],
    rows: [
        { row: 3, outcome: 'created', reference: 'ING-3', message: null },
        { row: 7, outcome: 'skipped', reference: 'ING-7', message: 'Unknown category' },
        { row: 9, outcome: 'failed', reference: null, message: 'Name (EN) is required' },
    ],
};

beforeEach(() => {
    pickerMock.getDocumentAsync.mockReset();
    canSave.mockReset().mockReturnValue(false);
    save.mockReset();
});

function pickResult(name: string, size: number, mimeType: string) {
    return {
        canceled: false,
        assets: [{ name, size, mimeType, uri: `file:///cache/${name}`, lastModified: 0 }],
    };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

async function renderActions(
    props: Omit<CatalogueTransferActionsProps, 'testID'> = {},
    repositories: RepositoryOverrides = {},
) {
    return renderStubScreen(<CatalogueTransferActions testID={ID} {...props} />, {
        repositories,
    });
}

async function openImport() {
    await fireEvent.press(screen.getByTestId(`${ID}-import`));
    await untilVisible(`${ID}-import-dialog`);
}

async function pick(name: string, size: number, mimeType = XLSX_MIME) {
    pickerMock.getDocumentAsync.mockResolvedValueOnce(pickResult(name, size, mimeType));
    await fireEvent.press(screen.getByTestId(`${ID}-import-drop-pick`));
}

describe('CatalogueTransferActions', () => {
    it('draws the disabled pair, with the reason in words, when nothing is wired', async () => {
        await renderActions();

        expect(screen.getByTestId(`${ID}-import`)).toBeDisabled();
        expect(screen.getByTestId(`${ID}-export`)).toBeDisabled();
        expect(screen.getByLabelText('Import is not available yet')).toBeTruthy();
        expect(screen.getByLabelText('Export is not available yet')).toBeTruthy();
    });

    it('lays out every column verbatim before asking for a file', async () => {
        await renderActions({ importGuide: GUIDE });
        await openImport();

        for (const column of GUIDE.columns) {
            expect(screen.getByText(column.header)).toBeTruthy();
        }
        // Name (EN), Category and Unit.
        expect(screen.getAllByText('Required')).toHaveLength(3);
        expect(
            within(screen.getByTestId(`${ID}-import-column-1`)).getByText('Required'),
        ).toBeTruthy();
        expect(
            within(screen.getByTestId(`${ID}-import-column-0`)).queryByText('Required'),
        ).toBeNull();
        expect(screen.getByText('Accepted: VEG, MEAT')).toBeTruthy();
        // Unit, Purchase unit and Capacity unit.
        expect(screen.getAllByText(`Accepted: ${UNITS}`)).toHaveLength(3);
        expect(screen.getByText('Up to 2000 rows per file.')).toBeTruthy();
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
    });

    it('downloads the template for its own resource', async () => {
        const file = { blob: new Blob(['x']), filename: null };
        const { repositories } = await renderActions(
            { importGuide: GUIDE },
            { kitchenAdmin: { downloadImportTemplate: async () => file } },
        );
        await openImport();

        await fireEvent.press(screen.getByTestId(`${ID}-import-template`));

        await waitFor(() => {
            expect(save).toHaveBeenCalledWith(file, 'ingredients-import-template.xlsx');
        });
        expect(repositories.kitchenAdmin.downloadImportTemplate).toHaveBeenCalledWith(
            'ingredients',
        );
    });

    it('refuses a file that is not a workbook, and sends nothing', async () => {
        const { repositories } = await renderActions(
            { importGuide: GUIDE },
            { kitchenAdmin: { importRecords: async () => REPORT } },
        );
        await openImport();

        await pick('list.csv', 1000, 'text/csv');

        await untilVisible(`${ID}-import-issue`);
        expect(screen.getByTestId(`${ID}-import-issue`)).toHaveTextContent(/not an Excel workbook/);
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
        expect(repositories.kitchenAdmin.importRecords).not.toHaveBeenCalled();
    });

    it('refuses a workbook over the size limit', async () => {
        await renderActions({ importGuide: GUIDE });
        await openImport();

        await pick('big.xlsx', 6 * 1024 * 1024);

        await untilVisible(`${ID}-import-issue`);
        expect(screen.getByTestId(`${ID}-import-issue`)).toHaveTextContent(/larger than 5 MB/);
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
    });

    it('accepts a .xlsx by name when the type is empty', async () => {
        await renderActions({ importGuide: GUIDE });
        await openImport();

        await pick('Dropped.XLSX', 1000, '');

        await untilVisible(`${ID}-import-drop-name`);
        expect(screen.queryByTestId(`${ID}-import-issue`)).toBeNull();
    });

    it('does nothing when the picker is cancelled', async () => {
        await renderActions({ importGuide: GUIDE });
        await openImport();

        pickerMock.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
        await fireEvent.press(screen.getByTestId(`${ID}-import-drop-pick`));

        await waitFor(() => {
            expect(pickerMock.getDocumentAsync).toHaveBeenCalled();
        });
        expect(screen.queryByTestId(`${ID}-import-issue`)).toBeNull();
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
    });

    it('uploads a picked workbook, reads the report back, and re-reads the lists', async () => {
        const { repositories, queryClient } = await renderActions(
            { importGuide: GUIDE },
            { kitchenAdmin: { importRecords: async () => REPORT } },
        );
        const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
        await openImport();

        await pick('ingredients.xlsx', 2048);
        await untilVisible(`${ID}-import-drop-name`);
        expect(screen.getByTestId(`${ID}-import-drop-name`)).toHaveTextContent('ingredients.xlsx');
        expect(screen.getByTestId(`${ID}-import-drop-size`)).toHaveTextContent('2.0 KB');

        await fireEvent.press(screen.getByTestId(`${ID}-import-submit`));
        await untilVisible(`${ID}-import-result`);

        expect(repositories.kitchenAdmin.importRecords).toHaveBeenCalledWith('ingredients', {
            file: {
                uri: 'file:///cache/ingredients.xlsx',
                name: 'ingredients.xlsx',
                type: XLSX_MIME,
            },
            fileName: 'ingredients.xlsx',
        });
        expect(screen.getByTestId(`${ID}-import-result-created`)).toHaveTextContent('2');
        expect(screen.getByTestId(`${ID}-import-result-updated`)).toHaveTextContent('1');
        expect(screen.getByTestId(`${ID}-import-result-unchanged`)).toHaveTextContent('5');
        expect(screen.getByTestId(`${ID}-import-result-skipped`)).toHaveTextContent('1');
        expect(screen.getByTestId(`${ID}-import-result-failed`)).toHaveTextContent('1');
        expect(screen.getByTestId(`${ID}-import-result-ignored`)).toHaveTextContent(
            'Ignored columns: Colour',
        );
        expect(screen.getByTestId(`${ID}-import-result-row-7`)).toHaveTextContent(
            'Row 7 · ING-7 · Unknown category',
        );
        expect(screen.getByTestId(`${ID}-import-result-row-9`)).toHaveTextContent(
            'Row 9 · Name (EN) is required',
        );
        // A created row is counted, never listed.
        expect(screen.queryByTestId(`${ID}-import-result-row-3`)).toBeNull();
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.kitchenAdmin.all() });

        await fireEvent.press(screen.getByTestId(`${ID}-import-done`));
        await waitFor(() => {
            expect(screen.queryByTestId(`${ID}-import-dialog`)).toBeNull();
        });

        // Reopened, it starts over: no file, no report.
        await openImport();
        expect(screen.queryByTestId(`${ID}-import-result`)).toBeNull();
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
    });

    it('says when to try again after a throttled import', async () => {
        await renderActions(
            { importGuide: GUIDE },
            { kitchenAdmin: { importRecords: async () => throwFailure(rateLimitFailure(120)) } },
        );
        await openImport();
        await pick('ingredients.xlsx', 2048);
        await untilVisible(`${ID}-import-drop-name`);

        await fireEvent.press(screen.getByTestId(`${ID}-import-submit`));

        await untilVisible(`${ID}-import-issue`);
        expect(screen.getByTestId(`${ID}-import-issue`)).toHaveTextContent(/Try again in 2 min/);
    });

    it('asks for a branch when the server needs one', async () => {
        await renderActions(
            { importGuide: GUIDE },
            {
                kitchenAdmin: {
                    importRecords: async () =>
                        throwFailure(apiFailure('context.organisation_required')),
                },
            },
        );
        await openImport();
        await pick('ingredients.xlsx', 2048);
        await untilVisible(`${ID}-import-drop-name`);

        await fireEvent.press(screen.getByTestId(`${ID}-import-submit`));

        await untilVisible(`${ID}-import-issue`);
        expect(screen.getByTestId(`${ID}-import-issue`)).toHaveTextContent(/Choose a branch first/);
    });

    it('shows the blocking warning instead of the drop zone', async () => {
        await renderActions({
            importGuide: GUIDE,
            importBlocked: { title: 'Pick a branch', body: 'Counts belong to one branch.' },
        });
        await openImport();

        expect(screen.getByTestId(`${ID}-import-blocked`)).toHaveTextContent(/Pick a branch/);
        expect(screen.queryByTestId(`${ID}-import-drop`)).toBeNull();
        expect(screen.getByTestId(`${ID}-import-submit`)).toBeDisabled();
    });

    describe('Export', () => {
        const pdfSelect = jest.fn();
        const menu = (load: ExcelLoad) => ({
            excel: { load, fallbackName: 'ingredients.xlsx' },
            pdf: [{ key: 'pdf', label: 'PDF', onSelect: pdfSelect }],
        });

        beforeEach(() => {
            pdfSelect.mockReset();
        });

        it('stays disabled where nothing can be saved and Excel is all it offers', async () => {
            await renderActions({
                exportMenu: { excel: { load: jest.fn(), fallbackName: 'x.xlsx' }, pdf: [] },
            });

            expect(screen.getByTestId(`${ID}-export`)).toBeDisabled();
        });

        it('leaves Excel off where nothing can be saved', async () => {
            await renderActions({ exportMenu: menu(jest.fn()) });

            await fireEvent.press(screen.getByTestId(`${ID}-export`));

            await untilVisible(`${ID}-export-pdf`);
            expect(screen.queryByTestId(`${ID}-export-excel`)).toBeNull();
            await fireEvent.press(screen.getByTestId(`${ID}-export-pdf`));
            expect(pdfSelect).toHaveBeenCalled();
        });

        it('downloads the workbook where it can be saved', async () => {
            canSave.mockReturnValue(true);
            const file = { blob: new Blob(['x']), filename: 'ingredients-2026-10-26.xlsx' };
            await renderActions(
                {
                    exportMenu: menu((repositories) =>
                        repositories.kitchenAdmin.exportIngredients(),
                    ),
                },
                { kitchenAdmin: { exportIngredients: async () => file } },
            );

            await fireEvent.press(screen.getByTestId(`${ID}-export`));
            await untilVisible(`${ID}-export-excel`);
            await fireEvent.press(screen.getByTestId(`${ID}-export-excel`));

            await waitFor(() => {
                expect(save).toHaveBeenCalledWith(file, 'ingredients.xlsx');
            });
        });

        it('toasts when the workbook cannot be fetched', async () => {
            canSave.mockReturnValue(true);
            await renderActions({
                exportMenu: menu(() => Promise.reject(new Error('offline'))),
            });

            await fireEvent.press(screen.getByTestId(`${ID}-export`));
            await untilVisible(`${ID}-export-excel`);
            await fireEvent.press(screen.getByTestId(`${ID}-export-excel`));

            await waitFor(() => {
                expect(screen.getByTestId('toast-region-assertive')).toHaveTextContent(
                    /export could not be downloaded/,
                );
            });
            expect(save).not.toHaveBeenCalled();
        });
    });
});
