import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { submitCanonicalRmnA2aTask, decode, encode } from "./submission.mjs";

export async function executeA2aMessage(source, options = {}) {
  const message = Message.fromJSON(source);
  if (message.role !== Role.ROLE_USER) throw new Error("submission die requires an A2A ROLE_USER message");
  const input = extractRmnPart(message.parts);
  const demand = decode(input.bytes);
  const receipt = await (options.submit ?? submitCanonicalRmnA2aTask)(demand, options);
  const output = encode(receipt);
  return Message.toJSON({ messageId: "", contextId: message.contextId, taskId: message.taskId, role: Role.ROLE_AGENT, parts: [rmnPart(output.bytes, "a2a-rmn-task-submission-receipt.rmn.cbor")], metadata: { inputNi: input.ni, outputNi: output.id, provider: receipt.provider }, extensions: [], referenceTaskIds: [] });
}
