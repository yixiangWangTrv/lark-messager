export function normalizeSessionResult(result) {
  if (result && typeof result === "object") {
    return result;
  }

  return {
    sessionId: result,
    sessionState: "existing",
  };
}
