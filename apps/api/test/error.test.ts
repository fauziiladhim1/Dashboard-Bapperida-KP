import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error.js';

const run = (err: unknown, log = vi.fn()) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  errorHandler(log)(err, {} as Request, res, vi.fn());
  return { status: res.status.mock.calls[0]![0], body: res.json.mock.calls[0]![0], log };
};

describe('errorHandler', () => {
  it('memetakan error postgres', () => {
    expect(run({ code: '23503' })).toMatchObject({ status: 409 });
    expect(run({ code: '23514' })).toMatchObject({ status: 400 });
  });

  it('body terlalu besar', () => {
    expect(run({ type: 'entity.too.large', status: 413 })).toMatchObject({ status: 413 });
  });

  it('error tak dikenal -> 500 tanpa membocorkan detail dan dicatat', () => {
    const { status, body, log } = run(new Error('rahasia internal'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('rahasia');
    expect(log).toHaveBeenCalled();
    expect(run({ code: '99999' }).status).toBe(500);
    expect(run(null).status).toBe(500);
  });

  it('default logger console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    errorHandler()(new Error('x'), {} as Request, res, vi.fn());
    expect(spy).toHaveBeenCalled();
  });
});
