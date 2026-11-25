export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Data'): HttpError => new HttpError(404, `${what} tidak ditemukan`);
