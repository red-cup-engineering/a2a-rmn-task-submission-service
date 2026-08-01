import { randomUUID } from "node:crypto";
import { AgentCard, Message, Role } from "@a2a-js/sdk";
import { ClientFactory, ServiceParameters, withA2AExtensions } from "@a2a-js/sdk/client";
import { discoverSignedAgentCard } from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { extractRmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { decodeSemantic, semanticBytes, semanticId } from "@red-cup-engineering/rmn-semantic-conformance";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, circuitInterfaceFromAgentCard } from "@red-cup-engineering/rmn-semantic-conformance-die/hierarchical-circuit";
import { decodeRelationalValue, encodeRelationalValue } from "@red-cup-engineering/rmn-semantic-conformance/relational-value";

export const ACTOR = "urn:ame:a2a-rmn-task-submission-service";
export const OPERATION = "submit-canonical-rmn-a2a-task";
function term(value) { const encoded = encodeRelationalValue(value); return ["ascribe", encoded.type, encoded.term]; }
export function canonical(value) { const valueTerm = term(value); return Object.freeze({ id: semanticId(valueTerm), bytes: semanticBytes(valueTerm) }); }

function exact(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string") throw new Error(`${label} must carry one canonical ni identity`);
  const body = { ...value }; delete body.id;
  const identity = canonical(body);
  if (value.id !== identity.id) throw new Error(`${label} identity does not equal its canonical RFC 8949 CBOR body`);
  return Object.freeze({ ...body, id: identity.id });
}
function receipt(body) { const identity = canonical(body); return Object.freeze({ ...body, id: identity.id }); }

function requestValue(bytes) {
  const decoded = decodeSemantic(bytes);
  if (!semanticBytes(decoded).equals(bytes) || decoded?.[0] !== "ascribe") throw new Error("submission requires canonical typed RMN CBOR");
  return decodeRelationalValue(decoded[1], decoded[2]);
}

export async function submitCanonicalRmnA2aTask(source, { discover = discoverSignedAgentCard, clientFactory = new ClientFactory(), signal } = {}) {
  const demand = exact(source, "submission demand");
  if (demand.type !== "A2aRmnTaskSubmissionDemand" || demand.provider !== ACTOR || demand.operation !== OPERATION) throw new Error("one exact canonical submission demand is required");
  if (demand.requireSignature !== true) throw new Error("submission requires an explicitly signed target face");
  if (typeof demand.targetAgentCardUrl !== "string" || !/^https?:\/\//u.test(demand.targetAgentCardUrl)) throw new Error("submission requires one absolute target Agent Card URL");
  const message = Message.fromJSON(demand.message);
  if (message.role !== Role.ROLE_USER) throw new Error("submission requires one A2A ROLE_USER message");
  const input = extractRmnPart(message.parts);
  if (!semanticBytes(decodeSemantic(input.bytes)).equals(input.bytes)) throw new Error("submission message carries noncanonical RMN bytes");
  const agentCard = await discover({ agentUrl: demand.targetAgentCardUrl, signal });
  const card = AgentCard.toJSON(agentCard);
  if ((card.securityRequirements?.length ?? 0) !== 0 || Object.keys(card.securitySchemes ?? {}).length !== 0) throw new Error("submission die has no ambient credential authority; target authentication is a separate articulation");
  const extensions = Array.isArray(demand.extensions) ? demand.extensions : [];
  const supported = new Set([SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, ...extensions]);
  const negotiated = new Set(extensions);
  for (const extension of card.capabilities?.extensions ?? []) if (extension.required === true) {
    if (!supported.has(extension.uri)) throw new Error(`target requires unsupported extension: ${extension.uri}`);
    negotiated.add(extension.uri);
  }
  if (negotiated.has(SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION)) circuitInterfaceFromAgentCard(card);
  const client = await clientFactory.createFromAgentCard(agentCard);
  const task = await client.sendMessage({ message: { ...message, messageId: message.messageId || randomUUID() }, configuration: { acceptedOutputModes: ["application/rmn+cbor"], historyLength: 0, returnImmediately: true } }, { signal, serviceParameters: ServiceParameters.create(withA2AExtensions(...negotiated)) });
  if (typeof task?.id !== "string" || !task.id) throw new Error("target submission returned no durable task identity");
  return receipt({ type: "A2aRmnTaskSubmissionReceipt", provider: ACTOR, operation: OPERATION, request: demand.id, targetAgentCardUrl: demand.targetAgentCardUrl, targetTaskId: task.id, targetInputNi: input.ni, targetCard: { url: demand.targetAgentCardUrl, signed: true }, extensions: [...negotiated].sort(), resource: { targetEffects: 1, downstreamLifecycleOwnedByTarget: true } });
}

export function encode(value) { return canonical(exact(value, "submission receipt")); }
export function decode(bytes) { return requestValue(bytes); }
