import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Log2Def Dashboard State Persistence and URL Synchronization Tests', () => {
  it('serializes and deserializes completed form details, entries, and answers without loss', () => {
    const originalState = {
      details: {
        name: 'Adebayo Samuel',
        inst: 'Lagos State University of Science and Technology',
        fac: 'College of Applied Sciences and Technology',
        dept: 'Computer Science',
        matric: 'STE/2021/0042',
        co: 'Google Deepmind Africa',
        addr: 'Victoria Island, Lagos',
        unit: 'AI Research & Engineering',
        start: '2026-01-10',
        end: '2026-07-10',
        sup: 'Dr. K. Balogun',
        isup: 'Prof. A. Adeleke',
      },
      answers: {
        dept: 'Computer Science',
      },
      fieldSources: {
        dept: 'user',
        matric: 'ocr',
      },
      entries: [
        { w: 1, t: 'System architecture review and environment setup', area: 'Software', tools: 'Git, Next.js', ok: 1 },
        { w: 2, t: 'Database schema migration testing with Lakebase Postgres', area: 'Backend', tools: 'Postgres', ok: 1 },
      ],
      pages: [
        { n: 'cover.jpg', pdf: false, th: 'data:image/jpeg;base64,samplethumb1', q: 'good' },
        { n: 'week1.jpg', pdf: false, th: 'data:image/jpeg;base64,samplethumb2', q: 'good' },
      ],
      step: 4,
      inFlow: true,
      currentTab: 'home',
      logbookView: 'pages',
      genState: 0,
      hasPaidDigital: false,
      deliveryData: {
        recipientName: 'Adebayo Samuel',
        phone: '08096044860',
        campusLocation: 'LASUSTECH Ikorodu Main Campus — College of Applied Sciences and Technology',
        customAddress: 'Hostel Block B, Room 14',
        deliveryDate: '2026-11-10',
        notes: 'Call upon arrival',
      },
    };

    const serialized = JSON.stringify(originalState);
    const restored = JSON.parse(serialized);

    assert.equal(restored.details.matric, 'STE/2021/0042');
    assert.equal(restored.details.co, 'Google Deepmind Africa');
    assert.equal(restored.entries.length, 2);
    assert.equal(restored.entries[0].tools, 'Git, Next.js');
    assert.equal(restored.pages.length, 2);
    assert.equal(restored.step, 4);
    assert.equal(restored.inFlow, true);
    assert.equal(restored.deliveryData.phone, '08096044860');
  });

  it('safely handles local storage quota constraints by stripping oversized thumbnails', () => {
    const hugeThumb = 'data:image/jpeg;base64,' + 'X'.repeat(60000);
    const pages = [
      { n: 'page1.jpg', pdf: false, th: hugeThumb, q: 'good' },
      { n: 'page2.jpg', pdf: false, th: 'data:image/jpeg;base64,small', q: 'good' },
    ];

    const sanitizedPages = pages.map((p) => ({
      n: p.n,
      pdf: p.pdf,
      th: p.th && p.th.length < 50000 ? p.th : '',
      q: p.q,
    }));

    assert.equal(sanitizedPages[0].th, '');
    assert.equal(sanitizedPages[0].n, 'page1.jpg');
    assert.equal(sanitizedPages[1].th, 'data:image/jpeg;base64,small');
  });

  it('resolves URL phase search parameters and hash attributes accurately', () => {
    const parseUrlPhase = (search: string, hashStr: string) => {
      const searchParams = new URLSearchParams(search);
      const hash = hashStr.replace('#/', '').replace('#', '').toLowerCase();

      const paramStep = searchParams.get('step');
      const paramTab = searchParams.get('tab');
      const paramView = searchParams.get('view');
      const paramStatus = searchParams.get('status');
      const paramCheckout = searchParams.get('checkout');

      let inFlow = false;
      let step = 1;
      let genState = 0;
      let tab = 'home';
      let view = 'pages';
      let modal: string | null = null;
      let status: string | null = null;

      if (paramStep) {
        if (paramStep === 'success' || paramStep === 'ready') {
          inFlow = true;
          step = 5;
          genState = 2;
        } else {
          const s = parseInt(paramStep, 10);
          if (s >= 1 && s <= 5) {
            step = s;
            inFlow = true;
          }
        }
      } else if (hash.startsWith('step-')) {
        if (hash === 'step-success') {
          inFlow = true;
          step = 5;
          genState = 2;
        } else {
          const s = parseInt(hash.replace('step-', ''), 10);
          if (s >= 1 && s <= 5) {
            step = s;
            inFlow = true;
          }
        }
      }

      if (paramStatus === 'ready' || paramStatus === 'success' || hash === 'step-success') {
        inFlow = true;
        step = 5;
        genState = 2;
      }

      if (paramTab === 'home' || hash === 'home' || hash === 'home-view') {
        tab = 'home';
        inFlow = false;
      } else if (paramTab === 'reports' || hash === 'reports' || hash === 'reports-view') {
        tab = 'reports';
        inFlow = false;
      } else if (paramTab === 'settings' || hash === 'settings' || hash === 'settings-view') {
        tab = 'settings';
        inFlow = false;
      } else if (
        paramTab === 'logbooks' ||
        hash === 'logbooks' ||
        hash === 'logbook-pages' ||
        hash === 'report' ||
        hash === 'technical-report'
      ) {
        tab = 'logbooks';
        inFlow = false;
        view = paramView === 'report' || hash === 'report' || hash === 'technical-report' ? 'report' : 'pages';
      }

      if (paramCheckout === 'digital' || hash === 'checkout-digital') modal = 'digital';
      else if (paramCheckout === 'delivery' || hash === 'checkout-delivery') modal = 'delivery';

      if (paramStatus === 'paid' || hash === 'payment-success') status = 'paid';
      else if (paramStatus === 'delivery-confirmed' || hash === 'delivery-success') status = 'delivery-confirmed';

      return { inFlow, step, genState, tab, view, modal, status };
    };

    // Test Step 1 URL
    const s1 = parseUrlPhase('?step=1', '#step-1');
    assert.equal(s1.inFlow, true);
    assert.equal(s1.step, 1);

    // Test Step 3 URL
    const s3 = parseUrlPhase('?step=3', '#step-3');
    assert.equal(s3.inFlow, true);
    assert.equal(s3.step, 3);

    // Test Generation Success URL
    const sSuccess = parseUrlPhase('?step=5&status=ready', '#step-success');
    assert.equal(sSuccess.inFlow, true);
    assert.equal(sSuccess.step, 5);
    assert.equal(sSuccess.genState, 2);

    // Test Technical Report Viewer in Logbooks tab
    const sReport = parseUrlPhase('?tab=logbooks&view=report', '#technical-report');
    assert.equal(sReport.inFlow, false);
    assert.equal(sReport.tab, 'logbooks');
    assert.equal(sReport.view, 'report');

    // Test Digital Checkout modal URL
    const sCheckoutDig = parseUrlPhase('?checkout=digital', '#checkout-digital');
    assert.equal(sCheckoutDig.modal, 'digital');

    // Test Delivery Checkout modal URL
    const sCheckoutDel = parseUrlPhase('?checkout=delivery', '#checkout-delivery');
    assert.equal(sCheckoutDel.modal, 'delivery');

    // Test Payment Success URL
    const sPaySuccess = parseUrlPhase('?status=paid', '#payment-success');
    assert.equal(sPaySuccess.status, 'paid');

    // Test Delivery Success URL
    const sDelSuccess = parseUrlPhase('?status=delivery-confirmed', '#delivery-success');
    assert.equal(sDelSuccess.status, 'delivery-confirmed');
  });
});
