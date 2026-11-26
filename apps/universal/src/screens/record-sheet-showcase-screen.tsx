import { Badge, Button, Cascade, DensityProvider, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { IngredientDetail } from '../features/kitchen-admin/catalogue/ingredient-detail.tsx';
import {
    RecordFigures,
    RecordSheetHead,
    RecordSteps,
    SheetCard,
    SheetColumns,
    SheetFacts,
    SheetTagRows,
    SheetText,
} from '../features/kitchen-admin/catalogue/record-sheet.tsx';
import { RecordViewPage } from '../features/kitchen-admin/catalogue/record-view-page.tsx';
import { BLANK, TAHINI, categoryName } from './record-canopy-showcase-screen.tsx';

function noop(): void {}

type Open = 'tahini' | 'blank' | 'packaging' | 'allergen' | null;

/**
 * `/showcase-record-sheet` — option A of the `Record pop-up — no canopy` canvas on its own page:
 * the Catalogue's records opened as the pop-up they now are, then the parts the sheet is made of,
 * laid flat so each can be looked at without opening anything.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function RecordSheetShowcaseScreen() {
    const [open, setOpen] = useState<Open>(null);
    const close = () => {
        setOpen(null);
    };
    const opener = (key: Exclude<Open, null>, label: string) => (
        <Button
            testID={`record-sheet-showcase-open-${key}`}
            variant="secondary"
            size="sm"
            label={label}
            onPress={() => {
                setOpen(key);
            }}
        />
    );

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="record-sheet-showcase">
                    <Text variant="title">Record sheet — the pop-up without the green band</Text>

                    <Text variant="section">The Catalogue's records — each opens as a pop-up</Text>
                    <View className="flex-row flex-wrap gap-2">
                        {opener('tahini', 'Ingredient — filled in')}
                        {opener('blank', 'Ingredient — nothing recorded yet')}
                        {opener('packaging', 'Packaging item (shared View page)')}
                        {opener('allergen', 'Allergen class (no photo)')}
                    </View>

                    {open !== 'tahini' ? null : (
                        <IngredientDetail
                            testID="record-sheet-showcase-tahini"
                            ingredient={TAHINI}
                            categoryName={categoryName}
                            onBack={close}
                            onEdit={noop}
                            onPrintLabel={noop}
                        />
                    )}
                    {open !== 'blank' ? null : (
                        <IngredientDetail
                            testID="record-sheet-showcase-blank"
                            ingredient={BLANK}
                            categoryName={categoryName}
                            onBack={close}
                            onPrintLabel={noop}
                        />
                    )}
                    {open !== 'packaging' ? null : (
                        <RecordViewPage
                            testID="record-sheet-showcase-packaging"
                            look="sheet"
                            eyebrow="Packaging"
                            title="Kraft bowl, 750 ml"
                            kind="Packaging item"
                            reference="PKG-0012"
                            status={{ label: 'Published', tone: 'success' }}
                            photo={{ assetId: undefined, label: 'Kraft bowl, 750 ml' }}
                            figureKeys={['purchasePrice', 'capacity', 'itemsPerUnit', 'waste']}
                            onBack={close}
                            fields={[
                                { key: 'reference', label: 'Reference', value: 'PKG-0012' },
                                { key: 'category', label: 'Category', value: 'Containers' },
                                { key: 'subcategory', label: 'Sub-category', value: 'Bowls' },
                                { key: 'unit', label: 'Unit', value: 'pc' },
                                { key: 'purchaseUnit', label: 'Bought in', value: 'Carton' },
                                { key: 'itemsPerUnit', label: 'Items per carton', value: '300' },
                                { key: 'purchasePrice', label: 'Pack price', value: 'AED 96.00' },
                                { key: 'capacity', label: 'Holds', value: '750 ml' },
                                { key: 'waste', label: 'Waste', value: '2%' },
                                {
                                    key: 'composition',
                                    label: 'Composition',
                                    value: 'Kraft paper with a PLA lining, compostable in industrial facilities',
                                },
                                { key: 'status', label: 'Status', value: 'Published' },
                                { key: 'updated', label: 'Updated', value: '3 days ago' },
                                { key: 'updatedBy', label: 'Updated by', value: 'Sara K.' },
                            ]}
                            primaryAction={{ label: 'Edit', onPress: noop }}
                        />
                    )}
                    {open !== 'allergen' ? null : (
                        <RecordViewPage
                            testID="record-sheet-showcase-allergen"
                            look="sheet"
                            eyebrow="Allergen classes"
                            title="Sesame"
                            kind="Allergen class"
                            reference="sesame"
                            status={{ label: 'Active', tone: 'brand' }}
                            figureKeys={['threshold', 'markets']}
                            onBack={close}
                            fields={[
                                {
                                    key: 'description',
                                    label: 'Examples',
                                    value: 'Sesame seeds, tahini, halva',
                                },
                                {
                                    key: 'regulation',
                                    label: 'Reference',
                                    value: 'EU 1169/2011 Annex II',
                                },
                                { key: 'markets', label: 'Markets', value: 'EU, UK, GCC' },
                                { key: 'threshold', label: 'Threshold', value: 'None set' },
                                {
                                    key: 'severe',
                                    label: 'Severe',
                                    value: 'Severe by default — every label shows it in bold',
                                },
                                {
                                    key: 'status',
                                    label: 'Status',
                                    value: 'Active — printed on new labels',
                                },
                            ]}
                        />
                    )}

                    <Text variant="section">The parts, laid flat</Text>
                    <View className="rounded-[20px] border border-stroke-subtle bg-surface-raised p-6">
                        <Cascade space="md">
                            <RecordSheetHead
                                testID="record-sheet-showcase-head"
                                title="Tahini paste"
                                titleAside="طحينة"
                                titleAsideLang="ar"
                                chips={[
                                    { key: 'status', label: 'Published', tone: 'success' },
                                    { key: 'sale', label: 'For sale', tone: 'info' },
                                    { key: 'filing', label: 'Pantry › Spreads', tone: 'neutral' },
                                ]}
                                changed={{
                                    label: 'Last changed',
                                    value: '2 days ago',
                                    note: 'by Sara K. · Version 7',
                                }}
                            />
                            <RecordSteps
                                testID="record-sheet-showcase-steps"
                                label="Where the order has got to"
                                noValue="—"
                                steps={[
                                    {
                                        key: 'draft',
                                        label: 'Draft',
                                        at: 'Made 9 Nov',
                                        state: 'done',
                                    },
                                    { key: 'issued', label: 'Issued', at: '10 Nov', state: 'done' },
                                    {
                                        key: 'partly',
                                        label: 'Partly received',
                                        at: '12 Nov · 2 deliveries',
                                        state: 'partial',
                                    },
                                    {
                                        key: 'received',
                                        label: 'Received',
                                        at: null,
                                        state: 'pending',
                                    },
                                ]}
                            />
                            <RecordFigures
                                testID="record-sheet-showcase-figures"
                                figures={[
                                    {
                                        key: 'a',
                                        label: 'Unit price',
                                        value: 'AED 18.40',
                                        note: 'per kg',
                                    },
                                    { key: 'b', label: 'Cost / 100 g', value: 'AED 1.84' },
                                    {
                                        key: 'c',
                                        label: 'B2B price',
                                        value: 'AED 24.00',
                                        note: 'margin 30.4 %',
                                    },
                                    { key: 'd', label: 'B2C price', value: '—', tone: 'muted' },
                                    {
                                        key: 'e',
                                        label: 'Still to come',
                                        value: '2',
                                        tone: 'warning',
                                    },
                                ]}
                            />
                            <SheetColumns
                                testID="record-sheet-showcase-columns"
                                top={
                                    <SheetCard
                                        testID="record-sheet-showcase-tags"
                                        title="Allergens and diets"
                                    >
                                        <SheetTagRows
                                            testID="record-sheet-showcase-tag-rows"
                                            rows={[
                                                {
                                                    key: 'contains',
                                                    label: 'Contains',
                                                    content: (
                                                        <Badge
                                                            tone="danger"
                                                            size="lg"
                                                            label="Sesame"
                                                        />
                                                    ),
                                                },
                                                {
                                                    key: 'may',
                                                    label: 'May contain',
                                                    content: (
                                                        <Badge
                                                            tone="warning"
                                                            size="lg"
                                                            label="Peanuts"
                                                        />
                                                    ),
                                                },
                                            ]}
                                        />
                                    </SheetCard>
                                }
                                start={
                                    <SheetCard testID="record-sheet-showcase-facts" title="Details">
                                        <SheetFacts
                                            testID="record-sheet-showcase-fact"
                                            facts={[
                                                { key: 'a', label: 'Bought in', value: 'Bucket' },
                                                {
                                                    key: 'b',
                                                    label: 'Also called',
                                                    value: 'Tahina, Sesame paste',
                                                },
                                                {
                                                    key: 'c',
                                                    label: 'Notes',
                                                    value: '—',
                                                    empty: true,
                                                },
                                            ]}
                                        />
                                    </SheetCard>
                                }
                                end={
                                    <SheetCard
                                        testID="record-sheet-showcase-text"
                                        title="Composition"
                                    >
                                        <SheetText text="Ground roasted sesame seeds" />
                                    </SheetCard>
                                }
                            />
                        </Cascade>
                    </View>
                </Cascade>
            </View>
        </DensityProvider>
    );
}
