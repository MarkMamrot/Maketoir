export function createReceiptPrintGate() {
  let pending = false;

  return {
    request(callback: () => void) {
      if (pending) return false;
      pending = true;
      try {
        callback();
        return true;
      } catch (error) {
        pending = false;
        throw error;
      }
    },
    complete() {
      pending = false;
    },
    isPending() {
      return pending;
    },
  };
}
