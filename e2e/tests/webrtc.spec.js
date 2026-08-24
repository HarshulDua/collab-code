import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById } from './helpers.js';

// Real getUserMedia needs real hardware, which CI/headless Chromium doesn't
// have — Chromium's fake-device flags substitute a synthetic video/audio
// track instead, so the RTCPeerConnection negotiation, ICE, and media flow
// are all exercised for real; only the camera/mic themselves are fake.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

test('two peers in the same room establish a live two-way WebRTC video connection', async ({ browser }) => {
  test.setTimeout(40000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await registerAndGoToRooms(pageA, 'Caller');
    const roomId = await createRoom(pageA, 'Video Room');

    await registerAndGoToRooms(pageB, 'Callee');
    await joinRoomById(pageB, roomId);

    // Local tile (index 0) getting real frames confirms getUserMedia + the
    // fake device actually attached before we look for the remote peer.
    for (const page of [pageA, pageB]) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForFunction(
        () => document.querySelector('.video-panel video.video-tile')?.readyState >= 2,
        { timeout: 15000 }
      );
    }

    // A remote tile (any index > 0) with non-zero dimensions means the
    // offer/answer + ICE exchange over webrtc:signal actually completed and
    // frames are flowing from the other peer, not just that a placeholder
    // <video> element got rendered.
    for (const page of [pageA, pageB]) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForFunction(
        () => {
          const tiles = Array.from(document.querySelectorAll('.video-panel video.video-tile'));
          return tiles.slice(1).some((v) => v.videoWidth > 0 && v.videoHeight > 0);
        },
        { timeout: 20000 }
      );
    }

    expect(await pageA.locator('.video-panel video.video-tile').count()).toBe(2);
    expect(await pageB.locator('.video-panel video.video-tile').count()).toBe(2);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('a peer leaving removes its video tile for the remaining peer', async ({ browser }) => {
  test.setTimeout(40000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await registerAndGoToRooms(pageA, 'Stayer');
    const roomId = await createRoom(pageA, 'Video Room 2');

    await registerAndGoToRooms(pageB, 'Leaver');
    await joinRoomById(pageB, roomId);

    await pageA.waitForFunction(
      () => {
        const tiles = Array.from(document.querySelectorAll('.video-panel video.video-tile'));
        return tiles.slice(1).some((v) => v.videoWidth > 0);
      },
      { timeout: 20000 }
    );

    await contextB.close();

    await pageA.waitForFunction(
      () => document.querySelectorAll('.video-panel video.video-tile').length === 1,
      { timeout: 15000 }
    );
  } finally {
    await contextA.close();
    await contextB.close().catch(() => {});
  }
});
