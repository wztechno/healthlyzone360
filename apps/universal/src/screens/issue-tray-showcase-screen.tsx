import {
    Button,
    Cascade,
    DensityProvider,
    FormGrid,
    FormSection,
    Inline,
    IssueTrayFrame,
    Tabs,
    Text,
    TextInputField,
    useIssueTrayController,
} from '@healthy360/design-system';
import type { IssueCardItem, IssueTrayContent } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { focusField } from '../features/kitchen-admin/field-focus.ts';

type DemoTab = 'details' | 'ingredients' | 'yield';

/**
 * `/showcase-issue-tray` — the issue tray on its own page, as the user asked for redesign parts
 * (2026-10-24): a small recipe form whose problems live in the tray rather than on the page.
 *
 * Every card here is derived from the fields on every render, exactly as a real editor does it:
 * fill a field and its card ticks and leaves by itself; empty it again and the card comes back.
 * Fix switches the tab, focuses the field and spotlights it. Save draft with a blocking card open
 * nudges the tray — it opens, and the pill in the top bar shakes.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function IssueTrayShowcaseScreen() {
    const tray = useIssueTrayController();
    const [tab, setTab] = useState<DemoTab>('details');
    const [arabic, setArabic] = useState('');
    const [cost, setCost] = useState('');
    const [portions, setPortions] = useState('');
    const [published, setPublished] = useState(false);

    const goTo = (target: DemoTab, fieldId: string) => {
        setTab(target);
        focusField(fieldId);
    };

    const portionsOk = Number.parseInt(portions, 10) > 0;
    const costOk = Number.parseFloat(cost) > 0;
    const arabicOk = arabic.trim().length > 1;

    const save: IssueCardItem[] = portionsOk
        ? []
        : [
              {
                  key: 'portions',
                  tone: 'danger',
                  label: 'Portions per batch is missing',
                  detail: 'Yield',
                  action: {
                      onPress: () => {
                          goTo('yield', 'showcase-portions');
                      },
                  },
                  testID: 'showcase-issue-portions',
              },
          ];
    const publish: IssueCardItem[] = [
        ...(costOk
            ? []
            : [
                  {
                      key: 'cost',
                      tone: 'warning' as const,
                      label: 'Chickpeas have no cost',
                      detail: 'Ingredients',
                      action: {
                          onPress: () => {
                              goTo('ingredients', 'showcase-cost');
                          },
                      },
                      testID: 'showcase-issue-cost',
                  },
              ]),
        ...(arabicOk
            ? []
            : [
                  {
                      key: 'arabic',
                      tone: 'warning' as const,
                      label: 'No Arabic name',
                      detail: 'Details',
                      action: {
                          onPress: () => {
                              goTo('details', 'showcase-arabic');
                          },
                      },
                      testID: 'showcase-issue-arabic',
                  },
              ]),
    ];

    const content: IssueTrayContent = {
        title: 'Publish checks',
        testID: 'showcase-tray',
        groups: [
            { key: 'save', title: 'Blocks save', items: save },
            { key: 'publish', title: 'Blocks publish', items: publish },
            {
                key: 'notes',
                title: 'Heads-up',
                items: [
                    {
                        key: 'stock',
                        tone: 'info',
                        label: 'Stock is short for 12 portions',
                        detail: 'Stock gaps',
                    },
                ],
            },
        ],
        passed: [
            { key: 'yield', label: 'Yield recorded', note: '1.46 Kg' },
            { key: 'allergens', label: 'Allergens confirmed', note: '4 raw materials' },
        ],
        notes: {
            title: 'Notes from the import',
            lines: [
                { key: 'source', text: 'Source: Recipe Library' },
                { key: 'note', text: 'Source note: B2C in 300 g bottles' },
            ],
        },
        doneLabel: published ? 'Published' : 'Ready to publish',
    };

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <IssueTrayFrame tray={content} controller={tray}>
                    <Cascade space="md" testID="issue-tray-showcase">
                        <Inline space="sm" align="center" justify="between" wrap>
                            <Text variant="title">Lentil soup</Text>
                            <Inline space="xs" align="center">
                                <Button
                                    variant="secondary"
                                    label="Save draft"
                                    onPress={() => {
                                        if (!portionsOk) tray.nudge();
                                    }}
                                />
                                <Button
                                    label="Publish"
                                    onPress={() => {
                                        if (save.length + publish.length > 0) tray.nudge();
                                        else setPublished(true);
                                    }}
                                />
                            </Inline>
                        </Inline>
                        <Tabs<DemoTab>
                            label="Recipe steps"
                            variant="steps"
                            value={tab}
                            onChange={setTab}
                            items={[
                                { value: 'details', label: 'Details' },
                                { value: 'ingredients', label: 'Ingredients' },
                                { value: 'yield', label: 'Yield' },
                            ]}
                        />
                        <FormSection variant="card" first title={tabTitle(tab)}>
                            <FormGrid>
                                {tab === 'details' ? (
                                    <TextInputField
                                        id="showcase-arabic"
                                        testID="showcase-arabic"
                                        label="Name (Arabic)"
                                        size="sm"
                                        value={arabic}
                                        onChangeText={setArabic}
                                    />
                                ) : tab === 'ingredients' ? (
                                    <TextInputField
                                        id="showcase-cost"
                                        testID="showcase-cost"
                                        label="Chickpeas cost per kg"
                                        size="sm"
                                        value={cost}
                                        onChangeText={setCost}
                                    />
                                ) : (
                                    <TextInputField
                                        id="showcase-portions"
                                        testID="showcase-portions"
                                        label="Portions per batch"
                                        size="sm"
                                        value={portions}
                                        onChangeText={setPortions}
                                        {...(portionsOk ? {} : { error: 'Required' })}
                                    />
                                )}
                            </FormGrid>
                        </FormSection>
                    </Cascade>
                </IssueTrayFrame>
            </View>
        </DensityProvider>
    );
}

function tabTitle(tab: DemoTab): string {
    if (tab === 'details') return 'Details';
    if (tab === 'ingredients') return 'Ingredients';
    return 'Yield';
}
