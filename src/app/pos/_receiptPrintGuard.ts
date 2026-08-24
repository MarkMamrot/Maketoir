export function createReceiptPrintGate() {
  let pending = false;
  let requested = false;

  return {
    request(callback: () => void) {
      if (pending || requested) return false;
      pending = true;
      requested = true;
      try {
        callback();
        return true;
      } catch (error) {
        pending = false;
        requested = false;
        throw error;
      }
    },
    complete() {
      pending = false;
    },
    isPending() {
      return pending;
    },
    hasRequested() {
      return requested;
    },
  };
}
