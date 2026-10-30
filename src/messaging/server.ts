/**
 * Worker side of the RPC: wires runtime.onMessage to the CommandRouter. The listener returns
 * true (async sendResponse) only for our RPC requests.
 */
import { type CommandRouter, isRpcRequest } from "../background/command-router";

type SendResponse = (response: unknown) => void;
interface SenderLike {
  id?: string;
}

export function createMessageListener(
  router: Pick<CommandRouter, "dispatch">,
  extensionId?: string,
): (msg: unknown, sender: SenderLike, sendResponse: SendResponse) => boolean {
  return (msg, sender, sendResponse) => {
    if (!isRpcRequest(msg)) return false;
    if (extensionId !== undefined && sender.id !== extensionId) return false;
    void router.dispatch(msg).then(sendResponse);
    return true;
  };
}

/** Registers the RPC listener on chrome.runtime.onMessage (call at worker top level). */
export function attachRpcServer(router: Pick<CommandRouter, "dispatch">): () => void {
  const listener = createMessageListener(router, chrome.runtime.id);
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
