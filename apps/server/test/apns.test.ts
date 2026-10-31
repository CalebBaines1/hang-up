import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { apnsJwt } from "../src/apns.ts";

test("APNs JWT is a valid ES256 token with the team and key ids", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = apnsJwt({ key: pem, keyId: "ABC123DEFG", teamId: "TEAM123456", iat: 1700000000 });
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "TEAM123456", iat: 1700000000 });
  const sig = Buffer.from(s, "base64url");
  assert.equal(sig.length, 64);
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig));
});
