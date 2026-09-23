import { afterEach, beforeEach, expect, test } from "bun:test";
import type http from "node:http";
import { hashToken, startHttp } from "../src/mcp";
import { rotateToken } from "../src/integrations/chatgpt";
import { readConfig } from "../src/vault";
import { makeVault, tmpHome } from "./helpers";

let vault: string, srv: http.Server | null = null, token: string, base: string;
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };

beforeEach(async () => {
  vault = makeVault(tmpHome());
  token = rotateToken(vault);
  srv = await startHttp(vault, { port: 0 });
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterEach(() => { srv?.close(); srv = null; });

test("token stored only as hash", () => {
  expect(readConfig(vault).remote.tokenHash).toBe(hashToken(token));
  expect(JSON.stringify(readConfig(vault))).not.toContain(token);
});

test("binds loopback only", () => expect((srv!.address() as { address: string }).address).toBe("127.0.0.1"));

test("401 without / with wrong token", async () => {
  expect((await fetch(`${base}/mcp`, { method: "POST", headers: H, body: JSON.stringify(INIT) })).status).toBe(401);
  expect((await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: "Bearer nope" }, body: JSON.stringify(INIT) })).status).toBe(401);
  expect((await fetch(`${base}/mcp/nope`, { method: "POST", headers: H, body: JSON.stringify(INIT) })).status).toBe(401);
});

test("bearer and secret path both work", async () => {
  const a = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify(INIT) });
  expect(a.status).toBe(200);
  expect(await a.text()).toContain("taste-profile");
  const b = await fetch(`${base}/mcp/${token}`, { method: "POST", headers: H, body: JSON.stringify(INIT) });
  expect(b.status).toBe(200);
});

test("foreign Origin rejected", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}`, origin: "https://evil.example" }, body: JSON.stringify(INIT) });
  expect(r.status).toBe(403);
});

test("oversized body rejected", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: "x".repeat(70_000) });
  expect(r.status).toBe(413);
});

test("unknown path 404, bad JSON 400", async () => {
  expect((await fetch(`${base}/other`)).status).toBe(404);
  expect((await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: "{bad" })).status).toBe(400);
});

test("rotating token invalidates the old one", async () => {
  rotateToken(vault);
  expect((await fetch(`${base}/mcp`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify(INIT) })).status).toBe(401);
});
