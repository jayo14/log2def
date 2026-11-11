import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Log2Def Report Switcher and Multi-Report State Management Tests', () => {
  it('manages workspace cache with TTL and cache invalidation cleanly', () => {
    const cache: Record<number, { data: any; cachedAt: number }> = {};

    const setCache = (id: number, data: any) => {
      cache[id] = { data, cachedAt: Date.now() };
    };

    const getCache = (id: number, maxAgeMs = 180_000) => {
      const entry = cache[id];
      if (!entry) return null;
      if (Date.now() - entry.cachedAt > maxAgeMs) return null;
      return entry.data;
    };

    const clearCache = (id?: number) => {
      if (id !== undefined) {
        delete cache[id];
      } else {
        Object.keys(cache).forEach((k) => delete cache[Number(k)]);
      }
    };

    // Store workspace in cache
    setCache(101, { title: 'Project 101', entriesCount: 12 });
    assert.deepEqual(getCache(101), { title: 'Project 101', entriesCount: 12 });

    // Invalidate single project cache on mutation
    clearCache(101);
    assert.equal(getCache(101), null);

    // TTL expiry simulation
    cache[102] = { data: { title: 'Expired Project' }, cachedAt: Date.now() - 200_000 };
    assert.equal(getCache(102), null);
  });

  it('guarantees zero state bleed when switching from populated Report A to empty Report B', () => {
    // Simulated state container representing dashboard workspace
    let state = {
      activeProjectId: 1,
      details: {
        name: 'Adebayo Samuel',
        matric: 'STE/2021/0042',
        dept: 'Computer Science',
        inst: 'LASUSTECH',
        co: 'Google Deepmind Africa',
      },
      pages: [{ id: 10, n: 'Page 1' }, { id: 11, n: 'Page 2' }],
      entries: [{ id: 101, w: 1, t: 'Week 1 log' }],
      chapterEdits: { 0: 'Cover Report A', 5: 'Chapter 1 Report A' },
      intake: { organisation_what: 'AI Research', duties: 'Model training' },
      hasPaidDigital: true,
      lastSavedDetailsHash: 'hash-project-a',
    };

    // Project B is a brand new draft report with 0 pages, 0 entries, unpaid
    const projectB = {
      id: 2,
      full_name: 'Chiamaka Okonkwo',
      matric_number: 'ENG/2022/0119',
      department: 'Electrical Engineering',
      university_name: 'LASUSTECH',
      organization_name: 'Chevron Nigeria',
      source_documents: [],
      logbook_entries: [],
      is_paid: false,
    };

    // Clean reset + hydration function contract
    const switchWorkspaceToProjectB = (proj: typeof projectB) => {
      state = {
        activeProjectId: proj.id,
        details: {
          name: proj.full_name || '',
          matric: proj.matric_number || '',
          dept: proj.department || '',
          inst: proj.university_name || '',
          co: proj.organization_name || '',
        },
        pages: proj.source_documents || [],
        entries: proj.logbook_entries || [],
        chapterEdits: {},
        intake: {},
        hasPaidDigital: proj.is_paid || false,
        lastSavedDetailsHash: JSON.stringify({
          name: proj.full_name,
          matric: proj.matric_number,
          dept: proj.department,
        }),
      };
    };

    switchWorkspaceToProjectB(projectB);

    assert.equal(state.activeProjectId, 2);
    assert.equal(state.details.name, 'Chiamaka Okonkwo');
    assert.equal(state.details.co, 'Chevron Nigeria');
    // Ensure pages & entries from Project A are completely wiped and not retained
    assert.equal(state.pages.length, 0);
    assert.equal(state.entries.length, 0);
    // Ensure chapterEdits & intake from Project A are completely wiped
    assert.deepEqual(state.chapterEdits, {});
    assert.deepEqual(state.intake, {});
    // Ensure payment status from Project A did not leak
    assert.equal(state.hasPaidDigital, false);
  });

  it('drops out-of-order responses using sequence counter to prevent race conditions', async () => {
    let switchSequence = 0;
    let appliedProjectId: number | null = null;

    const switchProject = async (targetId: number, delayMs: number) => {
      switchSequence += 1;
      const currentSeq = switchSequence;

      // Simulate async network delay
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // If a newer switch was initiated during in-flight fetch, discard obsolete response
      if (currentSeq !== switchSequence) {
        return; // Discarded!
      }

      appliedProjectId = targetId;
    };

    // User switches to Project 1 (slow, 80ms) then quickly switches to Project 2 (fast, 20ms)
    const p1 = switchProject(1, 80);
    const p2 = switchProject(2, 20);

    await Promise.all([p1, p2]);

    // Despite Project 1 finishing last, Project 2 must remain the active, applied project
    assert.equal(appliedProjectId, 2);
  });

  it('blocks auto-save execution during workspace switching', () => {
    let isSwitching = false;
    let saveCount = 0;

    const autoSave = (data: any) => {
      // Autosave guard: must abort when switching projects
      if (isSwitching) {
        return;
      }
      saveCount += 1;
    };

    // Normal editing: autosave fires
    autoSave({ name: 'Adebayo' });
    assert.equal(saveCount, 1);

    // Switching initiated: autosave is blocked
    isSwitching = true;
    autoSave({ name: 'Stale Data from old project' });
    assert.equal(saveCount, 1); // Not incremented!

    // Switching completed: autosave can fire for new project
    isSwitching = false;
    autoSave({ name: 'Chiamaka' });
    assert.equal(saveCount, 2);
  });

  it('filters project list accurately across title, student name, matric number, and company', () => {
    const projects = [
      {
        id: 1,
        title: 'SIWES Technical Report - Software Engineering',
        full_name: 'Adebayo Samuel',
        matric_number: 'STE/2021/0042',
        organization_name: 'Google Deepmind Africa',
      },
      {
        id: 2,
        title: 'Industrial Training Report - Power Systems',
        full_name: 'Chiamaka Okonkwo',
        matric_number: 'ENG/2022/0119',
        organization_name: 'Chevron Nigeria',
      },
      {
        id: 3,
        title: 'Agricultural Engineering Field Report',
        full_name: 'Tunde Bakare',
        matric_number: 'AGR/2020/0088',
        organization_name: 'Nestle Nigeria Plc',
      },
    ];

    const filterProjects = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return projects;
      return projects.filter((p) => {
        return (
          p.title.toLowerCase().includes(q) ||
          p.full_name.toLowerCase().includes(q) ||
          p.matric_number.toLowerCase().includes(q) ||
          p.organization_name.toLowerCase().includes(q)
        );
      });
    };

    // Filter by student name
    const byName = filterProjects('Chiamaka');
    assert.equal(byName.length, 1);
    assert.equal(byName[0].id, 2);

    // Filter by matric number
    const byMatric = filterProjects('STE/2021');
    assert.equal(byMatric.length, 1);
    assert.equal(byMatric[0].id, 1);

    // Filter by company name
    const byCompany = filterProjects('Nestle');
    assert.equal(byCompany.length, 1);
    assert.equal(byCompany[0].id, 3);

    // Filter with no matches
    const noMatch = filterProjects('Nonexistent');
    assert.equal(noMatch.length, 0);

    // Empty query returns all
    const all = filterProjects('   ');
    assert.equal(all.length, 3);
  });
});
