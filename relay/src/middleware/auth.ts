import { createHmac } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function createAuthMiddleware(secret: string) {
  return function verifyHmac(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const signature = req.headers["x-signature"] as string | undefined;
    const source = req.headers["x-source"] as string | undefined;

    if (!signature || !source) {
      res.status(401).json({
        ok: false,
        duplicate: false,
        accepted: false,
        error: "Missing authentication headers",
      });
      return;
    }

    if (source !== "mt5-ea") {
      res.status(403).json({
        ok: false,
        duplicate: false,
        accepted: false,
        error: "Unknown source",
      });
      return;
    }

    const rawBody = req.rawBody ?? JSON.stringify(req.body);

    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (!timingSafeEqual(signature, expected)) {
      res.status(403).json({
        ok: false,
        duplicate: false,
        accepted: false,
        error: "Invalid signature",
      });
      return;
    }

    next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  try {
    const { timingSafeEqual: tsEqual } = require("node:crypto");
    return tsEqual(bufA, bufB);
  } catch {
    // Fallback — still constant time for equal lengths
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i]! ^ bufB[i]!;
    }
    return result === 0;
  }
}
