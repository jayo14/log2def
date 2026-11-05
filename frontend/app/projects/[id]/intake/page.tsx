'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { projectsApi } from '@/lib/api';

type Step = { key: string; section: string; required: boolean; type: string; title: string; hint: string };
type ChallengePair = { challenge: string; solution: string };
type ChallengeAnswer = { none: boolean; pairs: ChallengePair[] };
type Person = { name: string; title: string };
type PeopleAnswer = { include: boolean; people: Person[]; thank_god: boolean; thank_family: boolean; raw?: string };
type Answer = string | ChallengeAnswer | PeopleAnswer;
type IntakeData = {
  answers: Record<string, Answer>;
  required_steps: Step[];
  optional_steps: Step[];
  logbook_prefill: { duties: string; label: string } | null;
  completeness: { can_generate: boolean };
};
type DraftState = { key: string; value: Answer };

const challengeDefaults: ChallengeAnswer = { none: false, pairs: [{ challenge: '', solution: '' }, { challenge: '', solution: '' }] };
const defaultAnswer = (step: Step, data: IntakeData | null): Answer => {
  const saved = data?.answers?.[step.key];
  if (saved !== undefined) return saved;
  if (step.type === 'challenge_pairs') return challengeDefaults;
  if (step.type === 'people_list') return { include: false, people: [], thank_god: false, thank_family: false };
  return '';
};
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export default function GuidedIntakePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params?.id || '');
  const [data, setData] = useState<IntakeData | null>(null);
  const [allRequired, setAllRequired] = useState<Step[]>([]);
  const [activeOptional, setActiveOptional] = useState<Step | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    projectsApi.getGuidedIntake<IntakeData>(projectId).then((result) => {
      if (!mounted) return;
      setData(result);
      setAllRequired(result.required_steps);
    }).catch((e: unknown) => {
      if (mounted) setError(errorText(e, 'Could not load the interview.'));
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [projectId]);

  const remaining = useMemo(() => {
    const keys = new Set(data?.required_steps.map((item) => item.key) || []);
    return allRequired.filter((item) => keys.has(item.key));
  }, [allRequired, data]);
  const step = activeOptional || remaining[0] || null;
  const savedDraft = step && draftState?.key === step.key ? draftState.value : null;
  const draft = savedDraft ?? (step ? defaultAnswer(step, data) : '');
  const progress = allRequired.length ? (allRequired.length - remaining.length) / allRequired.length : 1;
  const challengeDraft: ChallengeAnswer = typeof draft === 'object' && 'pairs' in draft ? draft : challengeDefaults;
  const peopleDraft: PeopleAnswer = typeof draft === 'object' && 'include' in draft ? draft : { include: false, people: [], thank_god: false, thank_family: false };
  const textDraft = typeof draft === 'string' ? draft : '';
  const setDraft = (value: Answer) => { if (step) setDraftState({ key: step.key, value }); };

  const save = async (answer: Answer) => {
    if (!step) return;
    setSaving(true);
    setError('');
    try {
      await projectsApi.saveGuidedIntakeAnswer(projectId, step.key, answer);
      const next = await projectsApi.getGuidedIntake<IntakeData>(projectId);
      setData(next);
      if (activeOptional) {
        const index = next.optional_steps.findIndex((item) => item.key === activeOptional.key);
        setActiveOptional(index >= 0 ? next.optional_steps[index + 1] || null : null);
      }
      setDraftState(null);
    } catch (e: unknown) {
      setError(errorText(e, 'Your answer could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!step) return;
    if (step.required && step.type !== 'challenge_pairs' && step.type !== 'people_list' && !textDraft.trim()) {
      setError('Please answer this question before continuing.');
      return;
    }
    if (step.type === 'challenge_pairs') {
      if (challengeDraft.none) return void save({ none: true, pairs: [] });
      const pairs = challengeDraft.pairs.slice(0, 3);
      if (pairs.length < 2 || pairs.some((pair) => !pair.challenge.trim() || !pair.solution.trim())) {
        setError('Complete two or three challenge and solution pairs, or choose “I had none”.');
        return;
      }
      return void save({ none: false, pairs });
    }
    if (step.type === 'people_list') {
      const people = (peopleDraft.raw || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [title, ...rest] = line.split('|');
        return { title: rest.length ? title.trim() : '', name: (rest.length ? rest.join('|') : title).trim() };
      });
      return void save({
        include: peopleDraft.include,
        people: peopleDraft.include ? people : [],
        thank_god: peopleDraft.thank_god,
        thank_family: peopleDraft.thank_family,
      });
    }
    void save(textDraft);
  };

  const skipOptional = () => {
    if (!step || step.required) return;
    if (step.type === 'people_list') return void save({ include: false, people: [], thank_god: false, thank_family: false });
    void save('');
  };

  if (loading) return <main className="mx-auto max-w-xl p-6 text-sm text-slate-600">Loading your report interview…</main>;
  if (!data) return <main className="mx-auto max-w-xl p-6 text-sm text-red-700">{error || 'Interview unavailable.'}</main>;

  if (!step) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-10 text-slate-900">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">Report interview complete</p>
        <h1 className="mt-3 text-3xl font-semibold">Your answers are saved</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Review the completeness checklist before generating. Any missing logbook facts still need your confirmation.</p>
        {data.optional_steps.length > 0 && <div className="mt-6 space-y-2">
          <p className="text-sm font-semibold">Optional pages and details</p>
          {data.optional_steps.map((optional) => <button key={optional.key} onClick={() => setActiveOptional(optional)} className="block min-h-11 text-left text-sm font-medium text-emerald-800">Add {optional.title.toLowerCase()} →</button>)}
        </div>}
        <button onClick={() => router.push('/dashboard#home')} className="mt-7 min-h-12 rounded-xl bg-emerald-800 px-5 font-semibold text-white">Return to report checklist</button>
      </main>
    );
  }

  const updatePair = (index: number, field: keyof ChallengePair, value: string) => {
    const pairs = [...challengeDraft.pairs];
    pairs[index] = { ...pairs[index], [field]: value };
    setDraft({ ...challengeDraft, none: false, pairs });
  };

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-6 text-slate-900 sm:px-6 sm:py-10">
      <header className="mb-8">
        <a href="/dashboard#home" className="text-sm font-medium text-emerald-800">← Back to report</a>
        <div className="mt-6 flex items-center justify-between text-xs text-slate-600">
          <span>{activeOptional ? 'Optional question' : `Required question ${Math.max(1, allRequired.length - remaining.length + 1)} of ${allRequired.length}`}</span>
          <span>{Math.round(progress * 100)}% complete</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-label="Interview progress">
          <div className="h-full rounded-full bg-emerald-700 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">{step.section.replaceAll('_', ' ')}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight">{step.title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{step.hint}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5">
          {step.type === 'challenge_pairs' ? (
            <div className="space-y-4">
              <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm">
                <input type="checkbox" checked={challengeDraft.none} onChange={(e) => setDraft({ ...challengeDefaults, none: e.target.checked })} />
                I had none
              </label>
              {!challengeDraft.none && challengeDraft.pairs.map((pair, index) => (
                <fieldset key={index} className="space-y-3 rounded-xl bg-slate-50 p-3">
                  <legend className="px-1 text-xs font-semibold text-slate-600">Challenge {index + 1} and its solution</legend>
                  <textarea aria-label={`Challenge ${index + 1}`} value={pair.challenge} onChange={(e) => updatePair(index, 'challenge', e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" />
                  <textarea aria-label={`Solution ${index + 1}`} value={pair.solution} onChange={(e) => updatePair(index, 'solution', e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" />
                </fieldset>
              ))}
              {!challengeDraft.none && challengeDraft.pairs.length < 3 && <button type="button" onClick={() => setDraft({ ...challengeDraft, pairs: [...challengeDraft.pairs, { challenge: '', solution: '' }] })} className="min-h-11 text-sm font-semibold text-emerald-800">+ Add a third pair</button>}
            </div>
          ) : step.type === 'people_list' ? (
            <div className="space-y-4">
              <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={peopleDraft.include} onChange={(e) => setDraft({ ...peopleDraft, include: e.target.checked })} /> Include an acknowledgement page</label>
              {peopleDraft.include && <>
                <label className="block text-sm font-medium" htmlFor="people-lines">Names and titles, one per line</label>
                <p className="text-xs text-slate-500">You may write a title, then “|”, then the name. Example formats are guidance only.</p>
                <textarea id="people-lines" value={peopleDraft.raw ?? peopleDraft.people.map((person) => `${person.title ? `${person.title} | ` : ''}${person.name}`).join('\n')} onChange={(e) => setDraft({ ...peopleDraft, raw: e.target.value })} rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
                <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={peopleDraft.thank_god} onChange={(e) => setDraft({ ...peopleDraft, thank_god: e.target.checked })} /> Add a “thank God” line</label>
                <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={peopleDraft.thank_family} onChange={(e) => setDraft({ ...peopleDraft, thank_family: e.target.checked })} /> Add a family acknowledgement line</label>
              </>}
            </div>
          ) : (
            <>
              {step.key === 'duties' && data.logbook_prefill && !textDraft && <button type="button" onClick={() => setDraft(data.logbook_prefill?.duties || '')} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left text-sm text-emerald-900"><strong>{data.logbook_prefill.label}</strong><span className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap text-xs">{data.logbook_prefill.duties}</span><span className="mt-2 block text-xs font-semibold">Tap to use and confirm this text</span></button>}
              {step.type === 'tree' || step.type === 'long_text' ? (
                <textarea autoFocus value={textDraft} onChange={(e) => setDraft(e.target.value)} rows={step.type === 'tree' ? 7 : 5} className="w-full rounded-xl border border-slate-300 p-3 text-base leading-6 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
              ) : (
                <input autoFocus value={textDraft} onChange={(e) => setDraft(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
              )}
            </>
          )}

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            {step.required ? <button type="button" onClick={() => setActiveOptional(data.optional_steps[0] || null)} className="min-h-11 rounded-xl px-3 text-sm text-slate-600">Optional questions</button> : <button type="button" disabled={saving} onClick={skipOptional} className="min-h-11 rounded-xl px-3 text-sm text-slate-600">Skip this optional question</button>}
            <button type="submit" disabled={saving} className="min-h-12 rounded-xl bg-emerald-800 px-6 font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save and continue'}</button>
          </div>
          {activeOptional && <button type="button" onClick={() => setActiveOptional(null)} className="mt-2 min-h-10 text-sm font-medium text-slate-500">Finish optional questions</button>}
        </form>
      </section>
    </main>
  );
}
