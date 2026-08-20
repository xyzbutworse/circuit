declare module "node:crypto" {
  export function createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string }; };
  export function createHmac(algorithm: string, key: string): { update(data: string): { digest(encoding: "hex" | "base64"): string }; };
}
