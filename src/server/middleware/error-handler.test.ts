import { errorHandler, createApiError } from "./error-handler";
import type { Request, Response, NextFunction } from "express";

function mockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("errorHandler", () => {
  it("returns the error status and message", () => {
    const err = createApiError(404, "Not found");
    const res = mockResponse();
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
  });

  it("defaults to 500 when no status is set", () => {
    const err = new Error("boom");
    const res = mockResponse();
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "boom" });
  });
});

describe("createApiError", () => {
  it("creates an Error with status property", () => {
    const err = createApiError(422, "Invalid data");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Invalid data");
    expect(err.status).toBe(422);
  });
});
