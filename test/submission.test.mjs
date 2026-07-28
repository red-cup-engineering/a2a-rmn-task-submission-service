import assert from "node:assert/strict";
import test from "node:test";
import { AgentCard, Message, Role } from "@a2a-js/sdk";
import { rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { canonical, ACTOR, OPERATION, submitCanonicalRmnA2aTask } from "../src/submission.mjs";

function demand() {
  const input = canonical({ kind: "BoundedTargetWork", value: "one" });
  const message = Message.toJSON({ messageId: "m1", contextId: "", taskId: "", role: Role.ROLE_USER, parts: [rmnPart(input.bytes, "work.rmn.cbor")], metadata: {}, extensions: [], referenceTaskIds: [] });
  const body = { type: "A2aRmnTaskSubmissionDemand", provider: ACTOR, operation: OPERATION, targetAgentCardUrl: "https://target.example/.well-known/agent-card.json", message, requireSignature: true, extensions: [] };
  return { ...body, id: canonical(body).id };
}
const card = AgentCard.fromJSON({ name: "signed-target", description: "fixture", url: "https://target.example", version: "1", protocolVersion: "1.0", preferredTransport: "JSONRPC", capabilities: { extensions: [] }, securitySchemes: {}, securityRequirements: [], supportedInterfaces: [{ protocolVersion: "1.0", protocolBinding: "JSONRPC", url: "https://target.example/a2a/jsonrpc" }], signatures: [{ protected: "x", signature: "x" }] });

test("submission verifies exact canonical demand and returns an exact durable receipt", async () => {
  let invoked = 0;
  const source = demand();
  const result = await submitCanonicalRmnA2aTask(source, {
    discover: async () => card,
    clientFactory: { createFromAgentCard: async () => ({ sendMessage: async () => { invoked += 1; return { id: "target-task-1" }; } }) },
  });
  assert.equal(invoked, 1);
  assert.equal(result.request, source.id);
  const { id, ...receiptBody } = result;
  assert.equal(id, canonical(receiptBody).id);
  assert.equal(result.targetTaskId, "target-task-1");
});

test("submission refuses an id that is not the canonical demand identity before effects", async () => {
  const source = { ...demand(), id: "ni:///sha-256;aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  await assert.rejects(submitCanonicalRmnA2aTask(source, { discover: async () => { throw new Error("must not discover"); } }), /identity/u);
});
