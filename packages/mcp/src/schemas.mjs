import { z } from "zod";

export const actionSchema = z.object({
  asset: z.string().min(1).max(24),
  assetId: z.string().min(1).max(24).optional(),
  side: z.enum(["BUY", "SELL"]),
  notionalUsd: z.number().positive().max(1_000_000_000),
  expectedSlippageBps: z.number().min(0).max(10_000).optional(),
});

export const portfolioIdSchema = z.object({
  portfolioId: z.string().min(1).max(64).default("alpha-01"),
});

export const projectSchema = portfolioIdSchema.extend({
  actions: z.array(actionSchema).min(1).max(6),
});

export const evaluateSchema = projectSchema;

export const explainSchema = portfolioIdSchema.extend({
  violation: z.object({
    code: z.string().min(1),
    issuer: z.string().optional(),
    sector: z.string().optional(),
    asset: z.string().optional(),
    assetId: z.string().optional(),
    projectedBps: z.number().optional(),
    maximumBps: z.number().optional(),
    limitBps: z.number().optional(),
    message: z.string().optional(),
  }),
});

export const requestAuthorizationSchema = portfolioIdSchema.extend({
  actions: z.array(actionSchema).min(1).max(6),
  portfolioStateHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  mandateVersion: z.number().int().min(1),
  evaluationHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export const executeSchema = portfolioIdSchema.extend({
  authorizationHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  authorization: z
    .object({
      portfolioId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      mandateVersion: z.union([z.number(), z.string()]),
      portfolioStateHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      actionsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      evaluationHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      expiry: z.union([z.number(), z.string()]),
      nonce: z.union([z.number(), z.string()]),
      signature: z.string().min(130),
    })
    .optional(),
  actions: z.array(actionSchema).min(1).max(6).optional(),
});

export const getReceiptSchema = z.object({
  receiptId: z.string().min(1).max(128),
});
