import type { DishOption } from '@healthy360/api-client/contracts';
import { createI18n } from '@healthy360/i18n';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import { DishChoiceFields } from './dish-choices.tsx';

/*
 * A chosen sauce or side shows what it adds to the plate before it is bought, on the meal page and
 * the desk alike: its recipe's allergens as badges, or a warning when nobody has assessed it. An
 * option with no allergen codes at all reads as unassessed, never as "none".
 */

/** One instance for the file: a fresh one per render produces overlapping `act()` scopes. */
const i18n = createI18n({ locale: 'en' });

async function renderIn(element: ReactElement) {
    await render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

function sauce(id: string, nameEn: string, allergenCodes: DishOption['allergenCodes']): DishOption {
    return {
        id,
        kind: 'choice',
        groupEn: 'Sauce',
        groupAr: 'صلصة',
        nameEn,
        nameAr: nameEn,
        allergenCodes,
    };
}

async function renderChosen(option: DishOption) {
    await renderIn(
        <DishChoiceFields
            testID="choices"
            options={[option]}
            portions={[]}
            value={{ catalogueItemVariantId: null, optionIds: [option.id] }}
            onChange={jest.fn()}
            formatPrice={() => ''}
        />,
    );
}

describe('the dish choice picker', () => {
    it('shows the chosen sauce’s allergens as badges', async () => {
        await renderChosen(sauce('aioli', 'Aioli', ['egg', 'milk']));

        expect(screen.getByTestId('choices-group-Sauce-allergens-egg')).toBeTruthy();
        expect(screen.getByText('Eggs')).toBeTruthy();
        expect(screen.getByTestId('choices-group-Sauce-allergens-milk')).toBeTruthy();
    });

    it('warns when the chosen sauce has not been assessed', async () => {
        await renderChosen(sauce('pesto', 'Pesto', null));

        expect(screen.getByTestId('choices-group-Sauce-allergens-unassessed')).toBeTruthy();
        expect(screen.getByText(/not checked yet/)).toBeTruthy();
        expect(screen.queryByTestId('choices-group-Sauce-allergens-none')).toBeNull();
    });

    it('treats a missing label as unassessed, never as none', async () => {
        await renderChosen(sauce('salsa', 'Salsa', undefined));

        expect(screen.getByTestId('choices-group-Sauce-allergens-unassessed')).toBeTruthy();
    });

    it('says so when the chosen sauce declares nothing', async () => {
        await renderChosen(sauce('salsa', 'Salsa', []));

        expect(screen.getByTestId('choices-group-Sauce-allergens-none')).toBeTruthy();
    });

    it('shows nothing until a sauce is chosen', async () => {
        await renderIn(
            <DishChoiceFields
                testID="choices"
                options={[sauce('aioli', 'Aioli', ['egg'])]}
                portions={[]}
                value={{ catalogueItemVariantId: null, optionIds: [] }}
                onChange={jest.fn()}
                formatPrice={() => ''}
            />,
        );

        expect(screen.queryByTestId('choices-group-Sauce-allergens-egg')).toBeNull();
    });
});
