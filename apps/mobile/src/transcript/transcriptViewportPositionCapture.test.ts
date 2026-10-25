import type { FlashListRef } from '@shopify/flash-list';
import { describe, expect, it } from 'vitest';
import { captureViewportRowPosition, measuredViewportRowPosition, mountedTranscriptNativeScrollOffset } from './transcriptViewportPositionCapture';

function ownerWithNativeHost(nativeHost: () => unknown) {
  return {
    getLayout: (index: number) => ({ x: 0, y: index === 128 ? 3_200 : 3_225, width: 1_000, height: 25 }),
    getWindowSize: () => ({ width: 1_020, height: 1_227 }),
    getAbsoluteLastScrollOffset: () => 2_643.5,
    getFirstItemOffset: () => 34,
    getChildContainerDimensions: () => ({ width: 1_020, height: 5_058 }),
    getNativeScrollRef: () => ({ getNativeScrollRef: nativeHost }),
  } as unknown as FlashListRef<unknown>;
}

function ownerWithNativeScrollTop(scrollTop: number) {
  return ownerWithNativeHost(() => ({ isConnected: true, scrollTop }));
}

function capture(owner: FlashListRef<unknown>, unsettled: { datasetKey: string; target: number; viewPosition: number } | null = null) {
  return captureViewportRowPosition({
    owner, target: 128, targetRow: undefined,
    preferObservedScroll: false, metrics: { offset: 2_643.5, viewportHeight: 1_227, contentHeight: 5_058 },
    observedScroll: true, datasetKey: 'A', unsettled, pending: null,
  });
}

describe('transcript viewport position capture', () => {
  it('captures the reader-visible native position when FlashList retained a fractional offset residual', () => {
    const position = capture(ownerWithNativeScrollTop(2_641));

    expect(position).toBeCloseTo(593 / 1_202, 6);
  });

  it('uses the same mounted offset when confirming a restored review position', () => {
    const position = measuredViewportRowPosition(
      ownerWithNativeScrollTop(2_641), 128, { first: 128, last: 129 },
      { offset: 2_643.5, viewportHeight: 1_227 }, true,
    );

    expect(position).toBeCloseTo(593 / 1_202, 6);
  });

  it('retains an issued reveal while its native write has not been acknowledged', () => {
    expect(capture(ownerWithNativeScrollTop(2_641), {
      datasetKey: 'A', target: 128, viewPosition: 0.61,
    })).toBe(0.61);
  });

  it('accepts a connected native offset of zero', () => {
    expect(mountedTranscriptNativeScrollOffset(ownerWithNativeScrollTop(0))).toBe(0);
  });

  it.each([
    ['missing host', () => null],
    ['disconnected host', () => ({ isConnected: false, scrollTop: 2_641 })],
    ['missing connection state', () => ({ scrollTop: 2_641 })],
    ['nonfinite offset', () => ({ isConnected: true, scrollTop: Number.NaN })],
    ['negative offset', () => ({ isConnected: true, scrollTop: -1 })],
  ])('rejects a %s and preserves the existing offset fallback', (_label, nativeHost) => {
    const owner = ownerWithNativeHost(nativeHost);

    expect(mountedTranscriptNativeScrollOffset(owner)).toBeNull();
    expect(capture(owner)).toBeCloseTo(590.5 / 1_202, 6);
  });

  it('falls back when reading the native host throws', () => {
    const owner = ownerWithNativeHost(() => { throw new Error('native host unavailable'); });

    expect(mountedTranscriptNativeScrollOffset(owner)).toBeNull();
    expect(capture(owner)).toBeCloseTo(590.5 / 1_202, 6);
  });
});

it('verifies exact leading-edge restores of oversized cards without hiding drift', () => {
  const metrics = { offset: 0, viewportHeight: 400 };
  const owner = ownerWithNativeScrollTop(800);
  owner.getLayout = () => ({ x: 0, y: 800, width: 900, height: 1000 });
  owner.getWindowSize = () => ({ width: 900, height: 400 });
  owner.getFirstItemOffset = () => 0;
  const sample = () => measuredViewportRowPosition(owner, 40, { first: 40, last: 40 }, metrics, false, 0);
  expect(sample()).toBe(0);
  expect(measuredViewportRowPosition(owner, 40, { first: 40, last: 40 }, metrics, false)).toBe(0.5);
  owner.getLayout = () => ({ x: 0, y: 820, width: 900, height: 1000 });
  expect(sample()).toBe(0.05);
  owner.getLayout = () => ({ x: 0, y: 780, width: 900, height: 1000 });
  expect(sample()).toBe(-0.05);
});
