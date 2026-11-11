import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Log2Def Download and Export Resilience Tests', () => {
  test('extracts filename correctly from Content-Disposition header with fallback', () => {
    const extractFilename = (header: string | null, fallback: string): string => {
      if (!header) return fallback;
      const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      return match?.[1] ? decodeURIComponent(match[1]) : fallback;
    };

    assert.equal(
      extractFilename('attachment; filename="LASUSTECH_SIWES_Report_v1.docx"', 'siwes.docx'),
      'LASUSTECH_SIWES_Report_v1.docx'
    );
    assert.equal(
      extractFilename("attachment; filename*=UTF-8''SIWES%20Report.pdf", 'siwes.pdf'),
      'SIWES Report.pdf'
    );
    assert.equal(
      extractFilename(null, 'default_report.pdf'),
      'default_report.pdf'
    );
  });

  test('sorts logbook entries strictly by week_number and then weekday order (Mon-Fri)', () => {
    const dayRank: Record<string, number> = {
      monday: 1, mon: 1,
      tuesday: 2, tue: 2, tues: 2,
      wednesday: 3, wed: 3,
      thursday: 4, thu: 4, thur: 4, thurs: 4,
      friday: 5, fri: 5,
    };

    const unsortedEntries = [
      { id: 1, week_number: 2, day_of_week: 'Thursday', order: 3 },
      { id: 2, week_number: 1, day_of_week: 'Wednesday', order: 2 },
      { id: 3, week_number: 1, day_of_week: 'Monday', order: 0 },
      { id: 4, week_number: 2, day_of_week: 'Monday', order: 0 },
      { id: 5, week_number: 1, day_of_week: 'Friday', order: 4 },
      { id: 6, week_number: 2, day_of_week: 'Tuesday', order: 1 },
      { id: 7, week_number: 1, day_of_week: 'Tuesday', order: 1 },
    ];

    const sorted = [...unsortedEntries].sort((a, b) => {
      const wA = Number(a.week_number) || 1;
      const wB = Number(b.week_number) || 1;
      if (wA !== wB) return wA - wB;
      const rA = dayRank[String(a.day_of_week || '').toLowerCase().trim()] || (Number(a.order) ?? 99);
      const rB = dayRank[String(b.day_of_week || '').toLowerCase().trim()] || (Number(b.order) ?? 99);
      return rA - rB;
    });

    const expectedOrder = [
      { week_number: 1, day_of_week: 'Monday' },
      { week_number: 1, day_of_week: 'Tuesday' },
      { week_number: 1, day_of_week: 'Wednesday' },
      { week_number: 1, day_of_week: 'Friday' },
      { week_number: 2, day_of_week: 'Monday' },
      { week_number: 2, day_of_week: 'Tuesday' },
      { week_number: 2, day_of_week: 'Thursday' },
    ];

    for (let i = 0; i < expectedOrder.length; i++) {
      assert.equal(sorted[i].week_number, expectedOrder[i].week_number);
      assert.equal(sorted[i].day_of_week, expectedOrder[i].day_of_week);
    }
  });

  test('parses server error response codes cleanly into student actionable feedback', () => {
    const resolveErrorMessage = (status: number, errJson: any): string => {
      if (status === 403) {
        return errJson?.error || 'You must complete payment before downloading.';
      }
      if (status === 422) {
        return errJson?.error || 'Report validation issue. Please review your chapters.';
      }
      return errJson?.error || 'Document is being compiled. Please tap download again in a moment.';
    };

    assert.equal(
      resolveErrorMessage(403, null),
      'You must complete payment before downloading.'
    );
    assert.equal(
      resolveErrorMessage(422, { error: 'Document quality gate blocked export.' }),
      'Document quality gate blocked export.'
    );
    assert.equal(
      resolveErrorMessage(500, null),
      'Document is being compiled. Please tap download again in a moment.'
    );
  });
});
