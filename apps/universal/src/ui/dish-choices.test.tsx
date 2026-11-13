import type { DishOption } from '@healthy360/api-client/contracts';
import { createI18n } from '@healthy360/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import { DishChoiceFields } from './dish-choices.tsx';

/*
 * Every sauce or side lists what it adds to the plate in its option label, and the chosen one shows it
 * again as badges, on the meal page and the desk alike. "May contain" is worded apart from "contains",
 * and an option with no label at all reads as unassessed, never as "none".
 */

/** One instance for the file: a fresh one per render produces overlapping `act()` scopes. */
const i18n = createI18n({ locale: 'en' });

async function renderIn(element: ReactElement) {
    await render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

function sauce(id: string, nameEn: string, allergens: DishOption['allergens']): DishOption {
    return {
        id,
        kind: 'choice',
        groupEn: 'Sauce',
        groupAr: 'صلصة',
        nameEn,
        nameAr: nameEn,
        allergens,
    };
}

const contains = (code: string) => ({ code, containment: 'contains' as const });
const mayContain = (code: string) => ({ code, containment: 'may_contain' as const });

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
        await renderChosen(sauce('aioli', 'Aioli', [contains('egg'), contains('milk')]));

        expect(screen.getByTestId('choices-group-Sauce-allergens-egg')).toBeTruthy();
        expect(screen.getByText('Eggs')).toBeTruthy();
        expect(screen.getByTestId('choices-group-Sauce-allergens-milk')).toBeTruthy();
    });

    it('warns when the chosen sauce has not been assessed', async () => {
        await renderChosen(sauce('pesto', 'Pesto', null));

        // The option's own label says it too, so the warning is read by its testID.
        expect(screen.getByTestId('choices-group-Sauce-allergens-unassessed')).toHaveTextContent(
            /not checked yet/,
        );
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
                options={[sauce('aioli', 'Aioli', [contains('egg')])]}
                portions={[]}
                value={{ catalogueItemVariantId: null, optionIds: [] }}
                onChange={jest.fn()}
                formatPrice={() => ''}
            />,
        );

        expect(screen.queryByTestId('choices-group-Sauce-allergens-egg')).toBeNull();
    });

    it('words a chosen sauce’s may-contain apart from what it contains', async () => {
        await renderChosen(sauce('aioli', 'Aioli', [contains('egg'), mayContain('sesame')]));

        expect(screen.getByText('Eggs')).toBeTruthy();
        expect(screen.getByText('May contain Sesame')).toBeTruthy();
    });

    it('lists every option’s allergens in its label before anything is picked', async () => {
        const removal: DishOption = {
            id: 'onion',
            kind: 'remove',
            groupEn: null,
            groupAr: null,
            nameEn: 'onions',
            nameAr: 'بصل',
            allergens: [],
        };
        await renderIn(
            <DishChoiceFields
                testID="choices"
                options={[
                    sauce('aioli', 'Aioli', [
                        contains('egg'),
                        contains('milk'),
                        mayContain('sesame'),
                    ]),
                    sauce('tahini', 'Tahini', [mayContain('peanut')]),
                    sauce('pesto', 'Pesto', null),
                    sauce('salsa', 'Salsa', []),
                    removal,
                ]}
                portions={[]}
                value={{ catalogueItemVariantId: null, optionIds: [] }}
                onChange={jest.fn()}
                formatPrice={() => ''}
            />,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('choices-group-Sauce-trigger'));
        });
        const label = (id: string) =>
            String(screen.getByTestId(`choices-group-Sauce-option-${id}`).props.accessibilityLabel);

        expect(label('aioli')).toBe('Aioli · Contains Eggs, Milk · May contain Sesame');
        expect(label('tahini')).toBe('Tahini · May contain Peanuts');
        expect(label('pesto')).toBe(
            'Pesto · Allergens not checked yet. Ask the kitchen before choosing it.',
        );
        expect(label('salsa')).toBe('Salsa');
        expect(screen.getByText('No onions')).toBeTruthy();
    });
});
