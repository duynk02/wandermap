import type { CreateCommentInput } from "@/types";

/** Build mutation variables once, before TanStack/REST retries can run the operation again. */
export function prepareCommentInput(input: CreateCommentInput): CreateCommentInput & { client_request_id: string } {
  return { ...input, client_request_id: input.client_request_id ?? crypto.randomUUID() };
}

/** Per-composer draft only: failed manual sends keep their key until edit or success. */
export function createCommentDraft() {
  let pending: { scope: string; input: ReturnType<typeof prepareCommentInput> } | null = null;
  return {
    prepare(scope: string, input: CreateCommentInput) {
      if (!pending || pending.scope !== scope || pending.input.content !== input.content || pending.input.parent_id !== input.parent_id) {
        pending = { scope, input: prepareCommentInput(input) };
      }
      return pending.input;
    },
    changed() { pending = null; },
    succeeded(requestId: string) {
      if (pending?.input.client_request_id === requestId) pending = null;
    },
  };
}
