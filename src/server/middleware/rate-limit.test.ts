import type { NextFunction, Request, Response } from "express";
import { createRateLimiter } from "./rate-limit";

function mockResponse() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function mockRequest(ip = "127.0.0.1") {
  return { ip, socket: { remoteAddress: ip } } as Request;
}

describe("createRateLimiter", () => {
  it("allows requests up to the limit and returns rate limit headers", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    const next = jest.fn() as NextFunction;
    const res = mockResponse();

    limiter(mockRequest(), res, next);
    limiter(mockRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", 0);
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Limit", 2);
  });

  it("rejects requests over the limit with retry information", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const next = jest.fn() as NextFunction;
    const res = mockResponse();

    limiter(mockRequest(), res, next);
    limiter(mockRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(Number));
    expect(res.json).toHaveBeenCalledWith({ error: "Too many requests" });
  });

  it("resets the count after the window expires", () => {
    jest.useFakeTimers();
    try {
      const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
      const next = jest.fn() as NextFunction;
      const res = mockResponse();

      limiter(mockRequest(), res, next);
      jest.advanceTimersByTime(1_001);
      limiter(mockRequest(), res, next);

      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
