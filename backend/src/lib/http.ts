import type { Response } from "express";

export function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}