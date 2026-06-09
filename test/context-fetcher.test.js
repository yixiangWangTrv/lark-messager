import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextFetcher } from "../lib/context-fetcher.js";

describe("ContextFetcher", () => {
  it("extracts text from Lark JSON text content", () => {
    const fetcher = new ContextFetcher({ context: {}, lark: {} });

    const text = fetcher._extractContent({
      msg_type: "text",
      body: {
        content: '{"text":"payment-service error rate is spiking"}',
      },
    });

    assert.equal(text, "payment-service error rate is spiking");
  });

  it("extracts plain text from post content blocks", () => {
    const fetcher = new ContextFetcher({ context: {}, lark: {} });

    const text = fetcher._extractContent({
      msg_type: "post",
      body: {
        content: JSON.stringify({
          zh_cn: {
            content: [
              [
                { tag: "text", text: "please analyze" },
                { tag: "at", user_id: "ou_xxx", user_name: "OncallBot" },
              ],
            ],
          },
        }),
      },
    });

    assert.equal(text, "please analyze @OncallBot");
  });
});
