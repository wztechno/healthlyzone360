import { useState } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { CodeBoxes } from '../ui/code-boxes.tsx';
import { ShopSwitch } from '../ui/shop-switch.tsx';

/**
 * `/showcase-shop` — the web shop's own parts, on a page of their own: the code boxes every
 * one-time code is typed into, in each state, and the shop's switch. Development only.
 */

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-4 rounded-3xl border border-stroke-subtle bg-surface-raised p-6">
            <RNText className="text-lg font-bold text-content-primary text-start">{title}</RNText>
            {children}
        </View>
    );
}

function Labelled({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-2">
            <RNText className="text-sm font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            {children}
        </View>
    );
}

export function ShopPartsShowcaseScreen() {
    const [code, setCode] = useState('');
    const [on, setOn] = useState(true);
    const [off, setOff] = useState(false);

    return (
        <View
            testID="shop-parts-showcase"
            className="w-full max-w-[880px] flex-col gap-6 self-center py-8"
        >
            <Section title="Code boxes">
                <Labelled label="Type here — the focused box blinks, digits pop in">
                    <CodeBoxes label="Code" length={6} value={code} onChangeText={setCode} />
                </Labelled>
                <Labelled label="Part typed">
                    <CodeBoxes label="Code" length={6} value="528" onChangeText={() => undefined} />
                </Labelled>
                <Labelled label="Wrong code">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        value="528061"
                        error="That code is not right. Check it and try again."
                        onChangeText={() => undefined}
                    />
                </Labelled>
                <Labelled label="Large, on an account card">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        size="lg"
                        align="start"
                        value="5280"
                        onChangeText={() => undefined}
                    />
                </Labelled>
            </Section>
            <Section title="Switch">
                <View className="flex-row items-center gap-6">
                    <ShopSwitch label="On" checked={on} onChange={setOn} />
                    <ShopSwitch label="Off" checked={off} onChange={setOff} />
                    <ShopSwitch label="Disabled" checked disabled onChange={() => undefined} />
                </View>
            </Section>
        </View>
    );
}
