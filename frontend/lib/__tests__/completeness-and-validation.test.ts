import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Date validation helper function mirroring frontend logic
function validateTrainingDates(startDate: string, endDate: string): { isValid: boolean; error: string | null } {
  if (!startDate || !endDate) {
    return { isValid: false, error: 'Both start and end dates are required.' };
  }
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return { isValid: false, error: 'Invalid date format.' };
  }
  if (s >= e) {
    return { isValid: false, error: 'Training start date must be strictly before training end date.' };
  }
  const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 3600 * 24));
  if (diffDays < 14) {
    return { isValid: false, error: 'Training period seems too short (under 2 weeks). Please verify dates.' };
  }
  return { isValid: true, error: null };
}

// Low-confidence segment parser mirroring PageReviewModal
function extractLowConfidenceTokens(text: string, serverSegments?: string[]): string[] {
  const list: string[] = [];
  if (serverSegments && Array.isArray(serverSegments)) {
    list.push(...serverSegments);
  }
  const matches = (text || '').match(/\[\?[^\]]*\]|\[unclear[^\]]*\]|\?\?\?/gi);
  if (matches) {
    matches.forEach((m) => {
      if (!list.includes(m)) list.push(m);
    });
  }
  return list;
}

// Client-side completeness evaluator
interface CompletenessAssessment {
  canGenerate: boolean;
  missingRequired: string[];
  uncertain: string[];
}

function evaluateProjectReadiness(
  project: Record<string, any>,
  hasLogbookEntries: boolean
): CompletenessAssessment {
  const requiredFields = [
    'full_name',
    'matric_number',
    'university_name',
    'department',
    'organization_name',
    'organization_address',
    'training_start_date',
    'training_end_date',
  ];

  const missingRequired: string[] = [];
  const uncertain: string[] = [];

  for (const field of requiredFields) {
    const val = project[field];
    if (!val || (typeof val === 'string' && val.trim() === '')) {
      missingRequired.push(field);
    } else if (typeof val === 'string' && (val.includes('[?]') || val.includes('[unclear]'))) {
      uncertain.push(field);
    }
  }

  if (!hasLogbookEntries) {
    missingRequired.push('logbook_entries');
  }

  const dateCheck = validateTrainingDates(project.training_start_date, project.training_end_date);
  const datesValid = dateCheck.isValid;

  const canGenerate = missingRequired.length === 0 && datesValid;

  return {
    canGenerate,
    missingRequired,
    uncertain,
  };
}

describe('Log2Def Completeness & Validation Unit Tests', () => {
  describe('Training Date Validation', () => {
    test('passes valid 6-month SIWES attachment dates', () => {
      const res = validateTrainingDates('2024-03-01', '2024-08-31');
      assert.equal(res.isValid, true);
      assert.equal(res.error, null);
    });

    test('rejects inverted date ranges (start > end)', () => {
      const res = validateTrainingDates('2024-09-01', '2024-03-01');
      assert.equal(res.isValid, false);
      assert.match(res.error!, /must be strictly before/);
    });

    test('rejects identical start and end dates', () => {
      const res = validateTrainingDates('2024-04-15', '2024-04-15');
      assert.equal(res.isValid, false);
      assert.match(res.error!, /must be strictly before/);
    });

    test('warns when training period is less than 14 days', () => {
      const res = validateTrainingDates('2024-04-01', '2024-04-07');
      assert.equal(res.isValid, false);
      assert.match(res.error!, /too short/);
    });
  });

  describe('Low-Confidence and Uncertain Token Extraction', () => {
    test('extracts bracketed OCR uncertainty markers', () => {
      const sample = 'Used [?] cable crimper to wire [unclear: RJ45 jack] in server rack ???';
      const tokens = extractLowConfidenceTokens(sample);
      assert.ok(tokens.includes('[?]'));
      assert.ok(tokens.includes('[unclear: RJ45 jack]'));
      assert.ok(tokens.includes('???'));
    });

    test('deduplicates merged server segments and text markers', () => {
      const sample = 'Tested patch panel [?]';
      const tokens = extractLowConfidenceTokens(sample, ['patch panel', '[?]']);
      assert.equal(tokens.length, 2);
      assert.deepEqual(tokens, ['patch panel', '[?]']);
    });
  });

  describe('Completeness & Generation Guard Rules', () => {
    test('blocks generation when required fields are missing', () => {
      const incompleteProject = {
        full_name: 'Ayobami Dayo',
        matric_number: 'STE/2021/001',
        university_name: 'LASUSTECH',
        department: 'Computer Engineering',
        organization_name: 'Tech Firm Ltd',
        // organization_address missing!
        // training_end_date missing!
        training_start_date: '2024-03-01',
      };

      const result = evaluateProjectReadiness(incompleteProject, true);
      assert.equal(result.canGenerate, false);
      assert.ok(result.missingRequired.includes('organization_address'));
      assert.ok(result.missingRequired.includes('training_end_date'));
    });

    test('blocks generation when zero logbook entries exist', () => {
      const validProject = {
        full_name: 'Ayobami Dayo',
        matric_number: 'STE/2021/001',
        university_name: 'LASUSTECH',
        department: 'Computer Engineering',
        organization_name: 'Tech Firm Ltd',
        organization_address: '12 Marina Street, Lagos Island',
        training_start_date: '2024-03-01',
        training_end_date: '2024-08-31',
      };

      const result = evaluateProjectReadiness(validProject, false);
      assert.equal(result.canGenerate, false);
      assert.ok(result.missingRequired.includes('logbook_entries'));
    });

    test('allows generation when all required fields exist even if optional fields are blank', () => {
      const completeProjectWithBlankOptionals = {
        full_name: 'Ayobami Dayo',
        matric_number: 'STE/2021/001',
        university_name: 'LASUSTECH',
        department: 'Computer Engineering',
        organization_name: 'Tech Firm Ltd',
        organization_address: '12 Marina Street, Lagos Island',
        training_start_date: '2024-03-01',
        training_end_date: '2024-08-31',
        // Optional fields left completely blank:
        placement_department: '',
        industry_supervisor_name: '',
        academic_supervisor_name: '',
      };

      const result = evaluateProjectReadiness(completeProjectWithBlankOptionals, true);
      assert.equal(result.canGenerate, true);
      assert.equal(result.missingRequired.length, 0);
    });

    test('identifies uncertain fields without blocking if not required or when resolved', () => {
      const projectWithUncertainty = {
        full_name: 'Ayobami Dayo',
        matric_number: 'STE/2021/001',
        university_name: 'LASUSTECH',
        department: 'Computer Engineering',
        organization_name: 'Tech Firm [?]',
        organization_address: '12 Marina Street, Lagos Island',
        training_start_date: '2024-03-01',
        training_end_date: '2024-08-31',
      };

      const result = evaluateProjectReadiness(projectWithUncertainty, true);
      assert.ok(result.uncertain.includes('organization_name'));
    });
  });
});
