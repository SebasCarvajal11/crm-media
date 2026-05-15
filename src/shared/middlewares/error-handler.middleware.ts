export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const onError = (err: Error, c: any) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status as any);
  }
  console.error(err);
  return c.json({ error: "Error interno del servidor" }, 500);
};