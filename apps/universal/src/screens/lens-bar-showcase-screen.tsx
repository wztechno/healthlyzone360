import { Button, Cascade, DensityProvider, Icon, Inline, Text } from '@healthy360/design-system';
import type { PublishableStatus } from '@healthy360/api-client/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { LensBar, LensScope } from '../features/kitchen-admin/catalogue/lens-bar.tsx';
import type { LensFigure, LensMixPart } from '../features/kitchen-admin/catalogue/lens-bar.tsx';

type Kind = 'all' | 'meal' | 'sauce' | 'preparation';

const COUNTS: Readonly<Record<PublishableStatus, number>> = {
    published: 29,
    draft: 80,
    review_required: 2,
    retired: 0,
};

/**
 * `/showcase-lens-bar` — the Lens bar on its own page, as the user asked for redesign parts
 * (2026-10-24): a recipes-shaped bar with working figures, scope, search and tokens, then the same
 * bar loading and with nothing to flag.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function LensBarShowcaseScreen() {
    const [status, setStatus] = useState<PublishableStatus | null>(null);
    const [onSale, setOnSale] = useState(false);
    const [kind, setKind] = useState<Kind>('all');
    const [search, setSearch] = useState('');

    const figure = (key: PublishableStatus, label: string, tone: LensFigure['tone']) => ({
        key,
        label,
        value: COUNTS[key],
        tone,
        active: status === key,
        onPress: () => {
            setStatus(key);
        },
    });
    const figures: readonly LensFigure[] = [
        {
            key: 'all',
            label: 'All recipes',
            value: 111,
            active: status === null,
            onPress: () => {
                setStatus(null);
            },
        },
        { ...figure('published', 'Published', 'success'), separated: true },
        figure('draft', 'Draft', 'warning'),
        { ...figure('review_required', 'Awaiting review', 'danger'), alarm: true },
        {
            key: 'onSale',
            label: 'On sale',
            value: 99,
            icon: 'eye',
            separated: true,
            active: onSale,
            onPress: () => {
                setOnSale(!onSale);
            },
        },
    ];
    const mix: readonly LensMixPart[] = (['published', 'draft', 'review_required'] as const).map(
        (key) => ({
            key,
            value: COUNTS[key],
            tone: key === 'published' ? 'success' : key === 'draft' ? 'warning' : 'danger',
            dimmed: status !== null && status !== key,
        }),
    );
    const filtered = status !== null || onSale || search !== '';

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="lens-bar-showcase">
                    <Text variant="title">Lens bar — try it</Text>
                    <LensBar
                        testID="showcase-lens"
                        label="Recipes summary and filters"
                        figures={figures}
                        mix={mix}
                        mixLabel="29 published, 80 draft, 2 awaiting review"
                        actions={
                            <Inline space="xs" align="center">
                                <Button variant="quiet" size="sm" label="Import" />
                                <Button variant="quiet" size="sm" label="Export" />
                                <Button
                                    label="New recipe"
                                    iconStart={<Icon name="plus" size="sm" />}
                                />
                            </Inline>
                        }
                        scope={
                            <LensScope<Kind>
                                testID="showcase-lens-kind"
                                label="Kind"
                                value={kind}
                                onChange={setKind}
                                options={[
                                    { value: 'all', label: 'All', count: 111 },
                                    { value: 'meal', label: 'Meals', count: 24 },
                                    { value: 'sauce', label: 'Sauces & marinations', count: 43 },
                                    { value: 'preparation', label: 'Preparations', count: 8 },
                                ]}
                            />
                        }
                        search={search}
                        onSearchChange={setSearch}
                        searchLabel="Search"
                        searchPlaceholder="Search recipes"
                        tokens={[
                            ...(status === null
                                ? []
                                : [
                                      {
                                          key: 'status',
                                          label: `Status: ${status}`,
                                          removeLabel: 'Remove the status filter',
                                          onRemove: () => {
                                              setStatus(null);
                                          },
                                      },
                                  ]),
                            ...(onSale
                                ? [
                                      {
                                          key: 'onSale',
                                          label: 'On sale',
                                          removeLabel: 'Remove the on sale filter',
                                          onRemove: () => {
                                              setOnSale(false);
                                          },
                                      },
                                  ]
                                : []),
                        ]}
                        result={filtered ? '18 of 42' : '18 of 111'}
                        clearLabel="Clear"
                        {...(filtered
                            ? {
                                  onClear: () => {
                                      setStatus(null);
                                      setOnSale(false);
                                      setSearch('');
                                  },
                              }
                            : {})}
                    />

                    <Text variant="title">Loading</Text>
                    <LensBar
                        testID="showcase-lens-loading"
                        label="Ingredients summary and filters"
                        figures={[
                            { key: 'all', label: 'All ingredients', value: null },
                            {
                                key: 'published',
                                label: 'Published',
                                value: null,
                                tone: 'success',
                                separated: true,
                            },
                            { key: 'draft', label: 'Draft', value: null, tone: 'warning' },
                        ]}
                        search=""
                        onSearchChange={() => undefined}
                        searchLabel="Search"
                        searchPlaceholder="Search ingredients"
                        result={null}
                        clearLabel="Clear"
                    />

                    <Text variant="title">Nothing to flag</Text>
                    <LensBar
                        testID="showcase-lens-clear"
                        label="Quotations summary and filters"
                        figures={[
                            { key: 'all', label: 'All quotes', value: 32, active: true },
                            {
                                key: 'draft',
                                label: 'Draft',
                                value: 6,
                                tone: 'warning',
                                separated: true,
                            },
                            { key: 'sent', label: 'Sent', value: 14, tone: 'info' },
                            { key: 'accepted', label: 'Accepted', value: 12, tone: 'success' },
                            { key: 'expired', label: 'Expired', value: 0, tone: 'neutral' },
                            {
                                key: 'value',
                                label: 'Accepted value',
                                value: 48200,
                                display: 'AED 48,200',
                                tone: 'brand',
                                separated: true,
                            },
                        ]}
                        mix={[
                            { key: 'draft', value: 6, tone: 'warning' },
                            { key: 'sent', value: 14, tone: 'info' },
                            { key: 'accepted', value: 12, tone: 'success' },
                        ]}
                        mixLabel="6 draft, 14 sent, 12 accepted"
                        search=""
                        onSearchChange={() => undefined}
                        searchLabel="Search"
                        searchPlaceholder="Search quotes or clients"
                        result="18 of 32"
                        clearLabel="Clear"
                    />
                </Cascade>
            </View>
        </DensityProvider>
    );
}
