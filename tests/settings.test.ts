import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, configFromSettings, flightSummary, normalizeSettings } from '../src/ui/screens';

describe('time of day setting', () => {
  it('defaults to day and rejects anything else', () => {
    expect(normalizeSettings({}).time).toBe('day');
    expect(normalizeSettings({ time: 'dusk' as never }).time).toBe('day');
    expect(normalizeSettings({ time: 'night' }).time).toBe('night');
  });
  it('passes night into the flight config', () => {
    expect(configFromSettings({ ...DEFAULT_SETTINGS, time: 'night' }).night).toBe(true);
    expect(configFromSettings(DEFAULT_SETTINGS).night).toBe(false);
  });
  it('says night in the summary only at night', () => {
    expect(flightSummary({ ...DEFAULT_SETTINGS, time: 'night' })).toMatch(/ · Night$/);
    expect(flightSummary(DEFAULT_SETTINGS)).not.toMatch(/Night|Day/);
  });
});
