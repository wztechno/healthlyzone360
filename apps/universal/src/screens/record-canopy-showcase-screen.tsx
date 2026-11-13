import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { Button, Cascade, DensityProvider, Icon, Text } from '@healthy360/design-system';
import { AllergenCode, IngredientId } from '@healthy360/domain-types';
import type { IsoDateTime, OrganisationId } from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';
import { useState } from 'react';
import { View } from 'react-native';

import { AllergenChoiceRow } from '../features/kitchen-admin/allergen-choice-row.tsx';
import type { AllergenChoice } from '../features/kitchen-admin/allergen-choice-row.tsx';
import { AllergenChip } from '../features/kitchen-admin/catalogue/allergen-chip.tsx';
import { IngredientDetail } from '../features/kitchen-admin/catalogue/ingredient-detail.tsx';
import {
    RecordCanopy,
    RecordCanopyGlyph,
} from '../features/kitchen-admin/catalogue/record-canopy.tsx';
import {
    RecordTile,
    RecordTileRow,
    TileEmpty,
    TileFacts,
} from '../features/kitchen-admin/catalogue/record-tiles.tsx';
import { RecordViewPage } from '../features/kitchen-admin/catalogue/record-view-page.tsx';
import { SegmentBar, SegmentKey } from '../features/kitchen-admin/catalogue/segment-bar.tsx';

const DASH = '—';
const NOW = '2026-11-01T09:00:00.000Z' as IsoDateTime;
const ORGANISATION = 'showcase-org' as OrganisationId;

function per100g(
    amounts: readonly (readonly [string, 'kcal' | 'g' | 'mg', number])[],
): NutritionFacts {
    return {
        basis: 'per_100g',
        kind: 'planned',
        serving: null,
        totalGrams: 100,
        amounts: amounts.map(([nutrientId, unit, value]) => ({
            nutrientId,
            unit,
            value,
            kind: 'planned',
            tolerance: null,
        })),
        source: {
            kind: 'synthetic_prototype',
            label: 'Showcase',
            version: '1',
            calculatedAt: NOW,
        },
        calculation: {
            method: 'showcase',
            basis: 'per_100g',
            calculatedAt: NOW,
            prototype: true,
            rounding: 'none',
            notes: [],
        },
    } as unknown as NutritionFacts;
}

const BLANK: IngredientAdmin = {
    id: IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0101'),
    meta: { lockVersion: 1, status: 'draft', updatedAt: NOW, updatedByName: 'Omar H.' },
    name: { en: 'Date syrup', ar: '' },
    slug: 'ingredient-date-syrup',
    reference: 'IG-231',
    categoryCode: '',
    subcategoryCode: null,
    measurementUnit: 'l',
    purchaseUnit: null,
    composition: null,
    itemsPerUnit: null,
    gramsPerUnit: null,
    purchasePrice: null,
    wastePercent: null,
    capacity: null,
    costPer100g: null,
    b2bPrice: null,
    b2cPrice: null,
    unitPrice: null,
    isSellable: false,
    per100g: null,
    nutritionDerivedFromVersionId: null,
    nutritionEstimated: null,
    nutritionNote: null,
    allergens: [],
    dietClassifications: [],
    aliases: [],
    organisationId: ORGANISATION,
    isEditable: true,
    forkedFromId: null,
    notes: null,
} as unknown as IngredientAdmin;

const TAHINI: IngredientAdmin = {
    ...BLANK,
    id: IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0102'),
    meta: { lockVersion: 7, status: 'published', updatedAt: NOW, updatedByName: 'Sara K.' },
    name: { en: 'Tahini paste', ar: 'طحينة' },
    slug: 'ingredient-tahini',
    reference: 'IG-014',
    categoryCode: 'pantry',
    subcategoryCode: 'spreads',
    measurementUnit: 'kg',
    composition: 'Ground roasted sesame seeds',
    costPer100g: { amount: 1.8, currency: 'AED' },
    unitPrice: { amount: 18.4, currency: 'AED' },
    b2bPrice: { amount: 24, currency: 'AED' },
    b2cPrice: { amount: 29.5, currency: 'AED' },
    per100g: per100g([
        ['energy', 'kcal', 595],
        ['protein', 'g', 17],
        ['fat', 'g', 53.8],
        ['saturated_fat', 'g', 7.5],
        ['carbohydrate', 'g', 21.2],
        ['sugars', 'g', 0.5],
        ['sodium', 'mg', 115],
    ]),
    nutritionEstimated: true,
    nutritionNote: 'Supplier label, March 2026 batch',
    allergens: [
        { allergenCode: AllergenCode.unsafe('sesame'), containment: 'contains' },
        { allergenCode: AllergenCode.unsafe('peanut'), containment: 'may_contain' },
    ],
    dietClassifications: ['vegan', 'gluten_free', 'halal_friendly'],
    aliases: ['Tahina', 'Sesame paste'],
    notes: 'Stir before weighing — the oil separates.',
} as unknown as IngredientAdmin;

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
    pantry: 'Pantry',
    spreads: 'Spreads & pastes',
};

function categoryName(code: string): string {
    return CATEGORY_NAMES[code] ?? code;
}

function noop(): void {}

/**
 * `/showcase-record-canopy` — option C of the `Minimal view page` canvas on its own page, as the
 * user asks for redesign parts: the ingredient view filled in and with nothing recorded yet, each
 * opened as the pop-up every View now is (`/showcase-record-popup` has the window itself), then
 * the parts it is made of — the canopy with a history strip, the allergen board's other state, the
 * segment bar.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function RecordCanopyShowcaseScreen() {
    const [open, setOpen] = useState<'tahini' | 'product' | 'blank' | null>(null);
    const [choice, setChoice] = useState<AllergenChoice>('contains');
    const close = () => {
        setOpen(null);
    };

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="record-canopy-showcase">
                    <Text variant="title">Record canopy</Text>

                    {/*
                     * Every View is a pop-up over its list since 2026-11-07, so the three records
                     * open from buttons rather than all drawing at once.
                     */}
                    <Text variant="section">The views — each opens as a pop-up</Text>
                    <View className="flex-row flex-wrap gap-2">
                        <Button
                            testID="record-canopy-showcase-open-tahini"
                            variant="secondary"
                            size="sm"
                            label="Ingredient — filled in"
                            onPress={() => {
                                setOpen('tahini');
                            }}
                        />
                        <Button
                            testID="record-canopy-showcase-open-product"
                            variant="secondary"
                            size="sm"
                            label="Shared record page — a product"
                            onPress={() => {
                                setOpen('product');
                            }}
                        />
                        <Button
                            testID="record-canopy-showcase-open-blank"
                            variant="secondary"
                            size="sm"
                            label="Ingredient — nothing recorded yet"
                            onPress={() => {
                                setOpen('blank');
                            }}
                        />
                    </View>
                    {open !== 'tahini' ? null : (
                        <IngredientDetail
                            testID="record-canopy-showcase-tahini"
                            ingredient={TAHINI}
                            categoryName={categoryName}
                            onBack={close}
                            onEdit={noop}
                            onPrintLabel={noop}
                        />
                    )}
                    {open !== 'product' ? null : (
                        <RecordViewPage
                            testID="record-canopy-showcase-product"
                            look="board"
                            eyebrow="Resale"
                            title="Hummus, 250 g tub"
                            kind="Product"
                            reference="PR-0031"
                            status={{ label: 'Published', tone: 'success' }}
                            onBack={close}
                            fields={[
                                { key: 'sku', label: 'SKU', value: 'HUM-250' },
                                { key: 'price', label: 'B2C price', value: 'AED 14.00' },
                                { key: 'recipe', label: 'Recipe', value: 'Hummus' },
                                { key: 'portion', label: 'Portion', value: '250 g' },
                            ]}
                            sections={[
                                {
                                    key: 'info',
                                    title: 'Shelf',
                                    icon: 'boxes',
                                    subtitle: 'How the tub is stored and sold.',
                                    content: (
                                        <Text>Chilled · sold in the shop and to businesses</Text>
                                    ),
                                },
                            ]}
                            chipsLabel="Channels"
                            chips={[
                                { key: 'b2c', label: 'Shop', tone: 'brand' },
                                { key: 'b2b', label: 'Business', tone: 'brand' },
                            ]}
                            statusLines={['Updated 3 days ago by Sara K.', 'Version 4']}
                            primaryAction={{ label: 'Edit product', onPress: noop }}
                            actions={[
                                {
                                    key: 'print',
                                    label: 'Print label',
                                    icon: 'receipt',
                                    onSelect: noop,
                                },
                                {
                                    key: 'archive',
                                    label: 'Archive',
                                    icon: 'archive',
                                    tone: 'danger',
                                    separated: true,
                                    onSelect: noop,
                                },
                            ]}
                        />
                    )}
                    {open !== 'blank' ? null : (
                        <IngredientDetail
                            testID="record-canopy-showcase-blank"
                            ingredient={BLANK}
                            categoryName={categoryName}
                            onBack={close}
                            onPrintLabel={noop}
                        />
                    )}

                    <Text variant="section">Canopy with a history strip</Text>
                    <RecordCanopy
                        testID="record-canopy-showcase-order"
                        title="Order PO-4F7K2Q"
                        status={{ label: 'Partly received', tone: 'warning' }}
                        captions={['Al Wadi Foods · Main kitchen · made Oct 28, 2026']}
                        media={
                            <RecordCanopyGlyph>
                                <Icon name="clipboardList" className="text-content-on-canopy" />
                            </RecordCanopyGlyph>
                        }
                        back={
                            <Button
                                variant="secondary"
                                size="sm"
                                label="Back"
                                iconStart={<Icon name="chevronStart" size="sm" />}
                                onPress={noop}
                            />
                        }
                        actions={
                            <>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    label="Print"
                                    onPress={noop}
                                />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    label="Receive delivery"
                                    onPress={noop}
                                />
                            </>
                        }
                        steps={[
                            { key: 'draft', label: 'Draft', at: 'Made Oct 28', state: 'done' },
                            {
                                key: 'issued',
                                label: 'Issued',
                                at: 'Oct 28, 2:10 PM',
                                state: 'done',
                            },
                            {
                                key: 'partly',
                                label: 'Partly received',
                                at: 'Oct 30 · 1 delivery',
                                state: 'partial',
                            },
                            { key: 'received', label: 'Received', at: null, state: 'pending' },
                        ]}
                        stepsLabel="Where the order has got to"
                        noValue={DASH}
                    />

                    <RecordTileRow>
                        <RecordTile
                            testID="record-canopy-showcase-clear"
                            title="Allergens — chips and the editor's row"
                            weight={7}
                        >
                            <View className="flex-row flex-wrap gap-1.5">
                                <AllergenChip code="sesame" containment="contains" />
                                <AllergenChip code="peanut" containment="may_contain" />
                                <AllergenChip code="sesame" containment="contains" size="md" />
                                <AllergenChip code="peanut" containment="may_contain" size="md" />
                            </View>
                            <AllergenChoiceRow
                                testID="record-canopy-showcase-choice"
                                name="Sesame"
                                value={choice}
                                onChange={setChoice}
                            />
                        </RecordTile>
                        <RecordTile
                            testID="record-canopy-showcase-parts"
                            icon="layers"
                            title="Segment bar, facts, empty"
                            weight={5}
                        >
                            <SegmentBar
                                testID="record-canopy-showcase-segments"
                                label="Unit price AED 18.40, B2B AED 24.00, B2C AED 29.50"
                                segments={[
                                    { key: 'a', share: 18.4, tone: 'deep' },
                                    { key: 'b', share: 5.6, tone: 'brand' },
                                    { key: 'c', share: 5.5, tone: 'info' },
                                ]}
                            />
                            <View className="flex-row flex-wrap gap-base">
                                <SegmentKey tone="deep" label="Deep" />
                                <SegmentKey tone="brand" label="Brand" />
                                <SegmentKey tone="info" label="Info" />
                                <SegmentKey tone="warning" label="Warning" />
                            </View>
                            <TileFacts
                                testID="record-canopy-showcase-facts"
                                facts={[
                                    { key: 'a', label: 'Payment terms', value: '30 days' },
                                    { key: 'b', label: 'Lead time', value: DASH, empty: true },
                                ]}
                            />
                            <TileEmpty
                                testID="record-canopy-showcase-empty"
                                text="Nothing received yet"
                            />
                        </RecordTile>
                    </RecordTileRow>
                </Cascade>
            </View>
        </DensityProvider>
    );
}
