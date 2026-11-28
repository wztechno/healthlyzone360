import {
    Button,
    Cascade,
    ChoiceChips,
    DensityProvider,
    SheetFacts,
    Text,
} from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import {
    PackStepper,
    PickedLinesBar,
    SendChecklist,
} from '../features/business/corporate-parts.tsx';
import { RecordViewPage } from '../features/kitchen-admin/catalogue/record-view-page.tsx';
import { SentBox } from '../features/business/screens/quotation-builder-screen.tsx';

function noop(): void {}

const DAYS = [
    { key: '2026-11-11', label: 'Wed 11' },
    { key: '2026-11-12', label: 'Thu 12' },
    { key: '2026-11-13', label: 'Fri 13' },
    { key: '2026-11-14', label: 'Sat 14' },
    { key: '2026-11-16', label: 'Mon 16' },
    { key: '2026-11-17', label: 'Tue 17' },
    { key: '2026-11-18', label: 'Wed 18' },
];
const WINDOWS = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'snack', label: 'Snack' },
    { key: 'dinner', label: 'Dinner', disabled: true },
];

/**
 * `/showcase-corporate` — the parts the corporate canvas (2026-11-10) added to the kitchen's kit,
 * each in its states, and the record sheet's progress strip and full-width lines as a quotation
 * draws them. Development builds only.
 */
export function CorporateShowcaseScreen() {
    const [day, setDay] = useState<string | null>('2026-11-13');
    const [win, setWin] = useState<string | null>('lunch');
    const [packs, setPacks] = useState(20);
    const [picked, setPicked] = useState<readonly string[]>(['Buffalo Dip', 'Caesar Dressing']);
    const [open, setOpen] = useState(false);

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="corporate-showcase">
                    <Text variant="title">Corporate — the B2B admin's own parts</Text>

                    <Text variant="section">
                        DeskChoiceChips — one choice from a few short ones
                    </Text>
                    <View className="max-w-[520px] gap-3">
                        <ChoiceChips
                            testID="corporate-showcase-days"
                            label="Delivery day"
                            items={DAYS}
                            value={day}
                            onChange={setDay}
                        />
                        <ChoiceChips
                            testID="corporate-showcase-windows"
                            label="Delivery window"
                            items={WINDOWS}
                            value={win}
                            onChange={setWin}
                        />
                    </View>

                    <Text variant="section">
                        PackStepper — packs, typed or stepped, never below 1
                    </Text>
                    <View className="flex-row items-center gap-3">
                        <PackStepper
                            testID="corporate-showcase-stepper"
                            label="Packs of Chicken White Tawouk"
                            value={packs}
                            onChange={setPacks}
                        />
                        <Text tone="secondary">{`${String(packs)} packs`}</Text>
                    </View>

                    <Text variant="section">PickedLinesBar — the catalogue's picked lines</Text>
                    <View className="gap-2">
                        <View className="flex-row gap-2">
                            <Button
                                testID="corporate-showcase-pick-more"
                                size="sm"
                                variant="secondary"
                                label="Pick five"
                                onPress={() => {
                                    setPicked([
                                        'Buffalo Dip',
                                        'Caesar Dressing',
                                        'Aioli Sauce',
                                        'Ranch Dressing',
                                        'Steak Sauce',
                                    ]);
                                }}
                            />
                        </View>
                        <PickedLinesBar
                            testID="corporate-showcase-picked"
                            names={picked}
                            onClear={() => {
                                setPicked([]);
                            }}
                            onAsk={noop}
                        />
                    </View>

                    <Text variant="section">SendChecklist — Before you send</Text>
                    <View className="flex-row flex-wrap gap-6">
                        <View className="w-[300px]">
                            <SendChecklist
                                testID="corporate-showcase-checks-ready"
                                checks={[
                                    {
                                        key: 'lines',
                                        ok: true,
                                        label: 'Lines',
                                        detail: '2 with a quantity',
                                    },
                                    {
                                        key: 'reply',
                                        ok: true,
                                        label: 'Reply to',
                                        detail: 'Bilal Buyer',
                                    },
                                    {
                                        key: 'delivery',
                                        ok: true,
                                        label: 'First delivery',
                                        detail: 'Nov 16, 2026',
                                    },
                                ]}
                            />
                        </View>
                        <View className="w-[300px]">
                            <SendChecklist
                                testID="corporate-showcase-checks-missing"
                                checks={[
                                    { key: 'lines', ok: false, label: 'Add at least one line' },
                                    { key: 'reply', ok: false, label: 'Who should we reply to?' },
                                    {
                                        key: 'delivery',
                                        ok: true,
                                        label: 'First delivery',
                                        detail: 'Not given',
                                    },
                                ]}
                            />
                        </View>
                    </View>

                    <Text variant="section">SentBox — a new quotation, sent</Text>
                    <SentBox reference="QUO-2026-A525F341" onList={noop} onAnother={noop} />

                    <Text variant="section">The record sheet's progress and full-width lines</Text>
                    <View className="flex-row">
                        <Button
                            testID="corporate-showcase-open-quotation"
                            size="sm"
                            variant="secondary"
                            label="A priced quotation"
                            onPress={() => {
                                setOpen(true);
                            }}
                        />
                    </View>
                </Cascade>
            </View>

            {open ? (
                <RecordViewPage
                    testID="corporate-showcase-quotation"
                    onBack={() => {
                        setOpen(false);
                    }}
                    eyebrow="Quotation"
                    title="QUO-2026-FED6E6F4"
                    kind="One delivery"
                    status={{ label: 'Priced', tone: 'warning' }}
                    statusLines={['Test employee meals · HealthZone360 Kitchen']}
                    steps={{
                        label: 'Progress',
                        steps: [
                            { key: 'asked', label: 'Asked', at: 'Oct 19, 2026', state: 'done' },
                            { key: 'priced', label: 'Priced', at: 'Oct 19, 2026', state: 'done' },
                            {
                                key: 'decision',
                                label: 'Your decision',
                                at: 'by Nov 13, 2026',
                                state: 'partial',
                            },
                        ],
                    }}
                    figureKeys={['total', 'raised', 'delivery', 'expires']}
                    figureTones={{ expires: 'warning' }}
                    fields={[
                        { key: 'total', label: 'Quoted total', value: '$42.00' },
                        { key: 'raised', label: 'Raised', value: 'Oct 19, 2026' },
                        { key: 'delivery', label: 'First delivery', value: '—' },
                        { key: 'expires', label: 'Expires', value: 'Nov 13, 2026' },
                    ]}
                    linesWide
                    headIcon="fileText"
                    linesCount="2 lines"
                    linesTitle="Lines"
                    lines={
                        <View className="gap-1">
                            <Text>Buffalo Dip — 6 × $4.50 = $27.00</Text>
                            <Text>Caesar Dressing — 3 × $5.00 = $15.00</Text>
                        </View>
                    }
                    sections={[
                        {
                            key: 'request',
                            title: 'Your request',
                            content: (
                                <SheetFacts
                                    testID="corporate-showcase-request"
                                    facts={[
                                        {
                                            key: 'programme',
                                            label: 'Programme',
                                            value: 'Test employee meals',
                                        },
                                        {
                                            key: 'schedule',
                                            label: 'Schedule',
                                            value: 'One delivery',
                                        },
                                        { key: 'reply', label: 'Reply to', value: 'Bilal Buyer' },
                                        { key: 'note', label: 'Note', value: '—', empty: true },
                                    ]}
                                />
                            ),
                        },
                    ]}
                    primaryAction={{ label: 'Accept and schedule', icon: 'check', onPress: noop }}
                    actions={[
                        {
                            key: 'decline',
                            label: 'Decline',
                            icon: 'close',
                            tone: 'danger',
                            onSelect: noop,
                        },
                    ]}
                />
            ) : null}
        </DensityProvider>
    );
}
