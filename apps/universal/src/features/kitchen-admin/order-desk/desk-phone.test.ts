import { checkDeskPhone, dialFor, isBlankPhone, normaliseDeskPhone } from './desk-phone.ts';

describe('desk phone', () => {
    it('opens on the kitchen country code', () => {
        expect(dialFor('LB')).toBe('+961');
        expect(dialFor('ZZ')).toBeNull();
        expect(dialFor(null)).toBeNull();
    });

    it('treats the code alone as nothing typed yet', () => {
        expect(isBlankPhone('+961 ', '+961')).toBe(true);
        expect(isBlankPhone('', '+961')).toBe(true);
        expect(isBlankPhone('+961 7', '+961')).toBe(false);
    });

    it('accepts Lebanese numbers of 7 or 8 digits, with or without the trunk 0', () => {
        expect(checkDeskPhone('+961 70 123 456', '+961')).toBeNull();
        expect(checkDeskPhone('+961 3 123 456', '+961')).toBeNull();
        expect(checkDeskPhone('+961 03 123 456', '+961')).toBeNull();
    });

    it('says how many digits a Lebanese number has when one is missing or extra', () => {
        const short = checkDeskPhone('+961 70 12 34', '+961');
        expect(short).toEqual({
            key: 'kitchen:desk.sale.phoneLength',
            params: { dial: '+961', min: 7, max: 8 },
        });
        expect(checkDeskPhone('+961 70 123 4567', '+961')?.key).toBe(
            'kitchen:desk.sale.phoneLength',
        );
    });

    it('asks for the country code when the plus is missing', () => {
        expect(checkDeskPhone('70123456', '+961')).toEqual({
            key: 'kitchen:desk.sale.phoneCountryCode',
            params: { dial: '+961' },
        });
    });

    it('holds another country to the server rule only', () => {
        expect(checkDeskPhone('+971 50 123 4567', '+961')).toBeNull();
        expect(checkDeskPhone('+44 12', '+961')?.key).toBe('kitchen:desk.sale.phoneInvalid');
    });

    it('sends the number the way the server stores it', () => {
        expect(normaliseDeskPhone('+961 03-123 456')).toBe('+9613123456');
        expect(normaliseDeskPhone('+961 70 123 456')).toBe('+96170123456');
        expect(normaliseDeskPhone('+1 555 0100 222')).toBe('+15550100222');
    });
});
