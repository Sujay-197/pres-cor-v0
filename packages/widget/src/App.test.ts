import type { DeliveryReport } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import {
  ApiError,
  OFFLINE_TAKES,
  analyzeTake,
  executeNextStep,
  fetchTakes,
  offlineReport,
  uploadTake,
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
  expect(takes[0]!.id).toBe('rough');
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
