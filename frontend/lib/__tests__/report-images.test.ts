import assert from 'node:assert/strict';
import test from 'node:test';
import { reportImageLabel, validReportImageCaption } from '../report-images.ts';

test('requires at least three caption words', () => {
  assert.equal(validReportImageCaption('workplace wiring'), false);
  assert.equal(validReportImageCaption('wiring bench inspection'), true);
});

test('numbers appendix captions sequentially', () => {
  assert.equal(reportImageLabel(2, 'wiring bench inspection'), 'Figure A.2: wiring bench inspection');
});
