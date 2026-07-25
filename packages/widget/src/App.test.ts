import type { DeliveryReport } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import roughFixture from '../../contracts/fixtures/report.rough.json';
import {
  ApiError,
  OFFLINE_TAKES,
  analyzeTake,
  executeNextStep,
  fetchTakes,
  offlineReport,
  runTakeLoad,
  uploadTake,
  type TakeLoadResult,
} from './App';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(response: Response, calls: Call[] = []): { f: typeof fetch; calls: Call[] } {
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('fetchTakes unwraps the takes array', async () => {
  const { f, calls } = stub(
    json({ takes: [{ id: 'rough', label: 'Rough take', mimeType: 'audio/mp4', hasFrozenTranscript: true }] }),
  );
  const takes = await fetchTakes(f);
  expect(takes).toHaveLength(1);
  // Full-shape assertion (not just `.id`): a server-side rename of `label`,
  // `mimeType` or `hasFrozenTranscript` would not fail an `.id`-only check,
  // and the widget's TakeOption is a duplicated type, not one shared with
  // the server, so drift has to be caught here.
  expect(takes[0]).toEqual({
    id: 'rough',
    label: 'Rough take',
    mimeType: 'audio/mp4',
    hasFrozenTranscript: true,
  });
  expect(calls[0]!.url).toBe('/api/takes');
});

test('fetchTakes raises ApiError carrying the server code', async () => {
  const { f } = stub(json({ error: { code: 'INTERNAL', message: 'Internal server error.' } }, 500));
  await expect(fetchTakes(f)).rejects.toBeInstanceOf(ApiError);
  await expect(fetchTakes(f)).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
});

test('analyzeTake posts the take id and returns the report', async () => {
  const { f, calls } = stub(json(cleanFixture));
  const report = await analyzeTake('clean', null, f);
  expect(report.reportId).toBe('rpt-demo-clean');
  expect(calls[0]!.url).toBe('/api/analyze');
  expect(calls[0]!.init.method).toBe('POST');
  expect(JSON.parse(String(calls[0]!.init.body)) as unknown).toEqual({ takeId: 'clean' });
});

test('analyzeTake pins `now` when one is supplied', async () => {
  const { f, calls } = stub(json(cleanFixture));
  await analyzeTake('clean', '2026-07-25T09:00:00Z', f);
  expect(JSON.parse(String(calls[0]!.init.body)) as unknown).toEqual({
    takeId: 'clean',
    now: '2026-07-25T09:00:00Z',
  });
});

test('analyzeTake surfaces a CoachError code from the server', async () => {
  const { f } = stub(json({ error: { code: 'SCRIPT_EMPTY', message: 'Script is empty.' } }, 400));
  await expect(analyzeTake('clean', null, f)).rejects.toMatchObject({
    code: 'SCRIPT_EMPTY',
    status: 400,
    message: 'Script is empty.',
  });
});

test('uploadTake posts multipart to /api/uploads and returns the new take id', async () => {
  const { f, calls } = stub(json({ takeId: 'up-0123456789ab' }));
  const file = new File([new Blob(['fake audio'])], 'clip.mp3', { type: 'audio/mpeg' });
  expect(await uploadTake(file, f)).toBe('up-0123456789ab');
  expect(calls[0]!.url).toBe('/api/uploads');
  expect(calls[0]!.init.method).toBe('POST');
  expect(calls[0]!.init.body).toBeInstanceOf(FormData);
  expect((calls[0]!.init.body as FormData).get('file')).toBeInstanceOf(File);
});

test('executeNextStep asks the server to execute and returns the receipt', async () => {
  const report = structuredClone(cleanFixture) as DeliveryReport;
  const executed = { ...report.nextStep!, executed: true };
  const { f, calls } = stub(json(executed));

  const step = await executeNextStep(report, 'clean', f);
  expect(step.executed).toBe(true);
  expect(calls[0]!.url).toBe('/api/tools/suggest_next_step');
  const body = JSON.parse(String(calls[0]!.init.body)) as { takeId: string; execute: boolean; now: string };
  expect(body.takeId).toBe('clean');
  expect(body.execute).toBe(true);
  expect(typeof body.now).toBe('string');
});

test('offlineReport serves the committed fixtures and nothing else', () => {
  expect(offlineReport('rough')!.reportId).toBe('rpt-demo-rough');
  expect(offlineReport('clean')!.reportId).toBe('rpt-demo-clean');
  expect(offlineReport('up-0123456789ab')).toBeNull();
});

test('offlineReport returns a fresh clone each call so the widget cannot mutate the fixture', () => {
  const first = offlineReport('rough')!;
  first.issues.length = 0;
  expect(offlineReport('rough')!.issues.length).toBeGreaterThan(0);
});

test('OFFLINE_TAKES covers exactly the two staged takes', () => {
  expect(OFFLINE_TAKES.map((t) => t.id)).toEqual(['clean', 'rough']);
  expect(OFFLINE_TAKES.every((t) => t.hasFrozenTranscript)).toBe(true);
});

/* ---------------------------------------------------------------------- *
 * runTakeLoad — race/cancellation guard. `f` here never resolves on its
 * own: each call to `f` parks its resolver, and the test decides the
 * settlement order, so these tests can force exactly the out-of-order
 * network arrival that a real slow response / fast response race produces.
 * ---------------------------------------------------------------------- */

function deferredFetch(): { f: typeof fetch; resolvers: Array<(res: Response) => void> } {
  const resolvers: Array<(res: Response) => void> = [];
  const f = (async () =>
    await new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    })) as unknown as typeof fetch;
  return { f, resolvers };
}

// `Response.json()` resolves over a macrotask under Node's implementation
// (a handful of `await Promise.resolve()` ticks is not enough to observe
// it settle), so this drains a real macrotask turn — twice, to give both a
// slower and a faster chain equal room to fully settle before assertions
// run. Verified against both a guarded and an unguarded runTakeLoad to
// confirm this ordering is what actually distinguishes them, not timing luck.
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('a stale response cannot overwrite a newer one once its load has been cancelled', async () => {
  const { f, resolvers } = deferredFetch();
  const results: TakeLoadResult[] = [];

  // Mirrors the App effect: takeId changes from "clean" to "rough", React
  // tears down the old effect (cancelling the in-flight "clean" load)
  // before the new effect for "rough" starts.
  const cancelClean = runTakeLoad('clean', (r) => results.push(r), f);
  cancelClean();
  runTakeLoad('rough', (r) => results.push(r), f);

  // Resolve out of order: the newer ("rough") request settles first, and
  // the stale, already-cancelled ("clean") request arrives late — both
  // fired before any await, so neither gets a timing head start.
  resolvers[1]!(json(roughFixture));
  resolvers[0]!(json(cleanFixture));
  await flush();

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: 'ready', offline: false });
  expect((results[0] as { report: DeliveryReport }).report.reportId).toBe('rpt-demo-rough');
});

test('a cancelled first invocation cannot clobber the surviving second one (StrictMode double-invoke)', async () => {
  const { f, resolvers } = deferredFetch();
  const results: TakeLoadResult[] = [];

  // StrictMode mounts, runs the effect, immediately cleans it up, then runs
  // it again — two loads for the SAME take, back to back.
  const cancelFirst = runTakeLoad('rough', (r) => results.push(r), f);
  cancelFirst();
  runTakeLoad('rough', (r) => results.push(r), f);

  // The cancelled first invocation's network response happens to land after
  // the surviving second invocation's.
  resolvers[1]!(json(roughFixture));
  resolvers[0]!(json(roughFixture));
  await flush();

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: 'ready', offline: false });
});
