import { useLocalSearchParams } from 'expo-router';

import { KdsTicketPrintScreen } from '../../src/features/kds/ticket-print-sheet.tsx';

/** `/kds/ticket?order=…` — one ticket on paper, from the board. A route so it is all the page prints. */
export default function KdsTicket() {
    const { order } = useLocalSearchParams<{ order?: string }>();
    return <KdsTicketPrintScreen order={order} />;
}
