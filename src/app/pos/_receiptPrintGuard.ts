export function createReceiptPrintGate(cooldownMs = 1000) {
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
      setTimeout(() => {
        pending = false;
      }, cooldownMs);
    },
    isPending() {
      return pending;
    },
  };
}
