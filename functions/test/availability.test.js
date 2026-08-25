'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeDays, openIntervalsForDate, subtract, normalise, DEFAULT_SETTINGS } = require('../lib/availability');
const { londonToUtc, londonTimeLabel } = require('../lib/time');

const settings = Object.assign({}, DEFAULT_SETTINGS, {
    slotIntervalMinutes: 30, appointmentMinutes: 30, bufferMinutes: 0,
    minNoticeHours: 0, maxFutureDays: 365
});
// A Tuesday well inside BST, and a Sunday.
const TUE = '2026-08-25';
const SUN = '2026-08-30';
const base = { settings, overrides: {}, busy: [], occupied: [], now: new Date('2026-08-01T00:00:00Z') };
const day = (over) => computeDays(Object.assign({ fromKey: TUE, toKey: TUE }, base, over))[0];

test('interval maths', () => {
    assert.deepStrictEqual(normalise([{start:60,end:120},{start:100,end:180}]), [{start:60,end:180}]);
    assert.deepStrictEqual(subtract([{start:0,end:100}], [{start:40,end:60}]), [{start:0,end:40},{start:60,end:100}]);
});

test('weekday generates slots across working hours', () => {
    const d = day();
    assert.strictEqual(d.open, true);
    // 10:00-18:00 at 30min = 16 slots
    assert.strictEqual(d.slots.length, 16);
    assert.strictEqual(d.slots[0].time, '10:00');
    assert.strictEqual(d.slots[15].time, '17:30');
    assert.ok(d.slots.every((s) => s.available));
});

test('slot instants are correct in BST', () => {
    const d = day();
    // 10:00 London in August is 09:00 UTC
    assert.strictEqual(d.slots[0].startIso, '2026-08-25T09:00:00.000Z');
    assert.strictEqual(londonTimeLabel(new Date(d.slots[0].startIso)), '10:00');
});

test('sunday is closed by the weekly pattern', () => {
    const d = computeDays(Object.assign({ fromKey: SUN, toKey: SUN }, base))[0];
    assert.strictEqual(d.open, false);
    assert.strictEqual(d.slots.length, 0);
});

test('manual open unlocks a closed sunday', () => {
    const d = computeDays(Object.assign({ fromKey: SUN, toKey: SUN }, base, {
        overrides: { [SUN]: { opens: [{ start: '12:00', end: '14:00' }] } }
    }))[0];
    assert.strictEqual(d.open, true);
    assert.strictEqual(d.slots.length, 4);
    assert.strictEqual(d.manualOpen, true);
});

test('manual block beats a manual open on the same day', () => {
    const d = day({ overrides: { [TUE]: {
        opens:  [{ start: '09:00', end: '10:00' }],
        blocks: [{ start: '09:00', end: '12:00' }]
    } } });
    assert.strictEqual(d.slots[0].time, '12:00');
});

test('whole-day close beats everything', () => {
    const d = day({ overrides: { [TUE]: { closed: true, opens: [{ start: '09:00', end: '17:00' }] } } });
    assert.strictEqual(d.open, false);
    assert.strictEqual(d.slots.length, 0);
});

test('calendar busy removes overlapping slots only', () => {
    const d = day({ busy: [{ start: londonToUtc(TUE,'11:00'), end: londonToUtc(TUE,'12:00') }] });
    const at = (t) => d.slots.find((s) => s.time === t);
    assert.strictEqual(at('10:30').available, true);
    assert.strictEqual(at('11:00').available, false);
    assert.strictEqual(at('11:00').reason, 'calendar');
    assert.strictEqual(at('11:30').available, false);
    assert.strictEqual(at('12:00').available, true);
});

test('ignoreCalendarBusy lets an explicit manual open win over the calendar', () => {
    const d = day({
        busy: [{ start: londonToUtc(TUE,'11:00'), end: londonToUtc(TUE,'12:00') }],
        overrides: { [TUE]: { ignoreCalendarBusy: true } }
    });
    assert.strictEqual(d.slots.find((s) => s.time === '11:00').available, true);
});

test('held slots block, and buffer widens the clash window', () => {
    const withBuffer = Object.assign({}, settings, { bufferMinutes: 15 });
    const d = computeDays(Object.assign({ fromKey: TUE, toKey: TUE }, base, {
        settings: withBuffer,
        occupied: [{ start: londonToUtc(TUE,'11:00'), end: londonToUtc(TUE,'11:30') }]
    }))[0];
    const at = (t) => d.slots.find((s) => s.time === t);
    assert.strictEqual(at('11:00').reason, 'taken');
    // 10:30-11:00 now clashes because the 15min buffer overlaps the 11:00 hold
    assert.strictEqual(at('10:30').available, false);
    assert.strictEqual(at('12:00').available, true);
});

test('minimum notice hides slots that are too soon', () => {
    const d = computeDays(Object.assign({ fromKey: TUE, toKey: TUE }, base, {
        settings: Object.assign({}, settings, { minNoticeHours: 4 }),
        now: londonToUtc(TUE, '09:00')
    }))[0];
    const at = (t) => d.slots.find((s) => s.time === t);
    assert.strictEqual(at('12:30').available, false);
    assert.strictEqual(at('12:30').reason, 'notice');
    assert.strictEqual(at('13:00').available, true);
});

test('appointment longer than the interval will not overflow closing time', () => {
    const d = computeDays(Object.assign({ fromKey: TUE, toKey: TUE }, base, {
        settings: Object.assign({}, settings, { slotIntervalMinutes: 30, appointmentMinutes: 60 })
    }))[0];
    // last 60min appointment that fits before 18:00 starts at 17:00
    assert.strictEqual(d.slots[d.slots.length - 1].time, '17:00');
});

test('legacy blockedDates list still closes a date', () => {
    const d = day({ settings: Object.assign({}, settings, { blockedDates: [TUE] }) });
    assert.strictEqual(d.open, false);
});
